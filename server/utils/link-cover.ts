import type { PublicWish } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { setWishCover } from '../domain/wishes'
import { type Cover, FetchError, type FetchOptions, fetchPicture, guardedGet, pictureAt, withinTime } from './guarded-fetch'
import { countHit, isLimited } from './rate-limit'
import { removeUpload, removeUploads, saveUpload } from './uploads'

// The picture a shop's page names as its own (og:image and the like), fetched by the server for
// the first link of a wish. How the server fetches anything at all is in guarded-fetch.ts;
// nothing of the shop's answer comes back from here but the picture.

export type CoverOptions = FetchOptions

// ── What a page names as its cover ───────────────────────────────────────────────────────────

/** Where a page may name its cover, the first that gives a usable address wins. */
const COVER_NAMES = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'] as const

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }

/** An attribute's value with its character references read: `&amp;`, `&#38;`, `&#x26;`. Others stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|([a-z]+));/gi, (whole, hex?: string, decimal?: string, name?: string) => {
    if (name) return NAMED[name.toLowerCase()] ?? whole
    const code = hex ? Number.parseInt(hex, 16) : Number(decimal)
    return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : whole
  })
}

const SPACE = /\s/

/**
 * The attributes of the tag that starts at `from`, just past its name: quoted with either
 * quote or not at all, in any order, names in lower case. Null when the page ends inside the tag.
 */
export function attributesAt(html: string, from: number): { attributes: Map<string, string>, end: number } | null {
  const attributes = new Map<string, string>()
  let at = from
  for (;;) {
    while (at < html.length && (SPACE.test(html[at]!) || html[at] === '/')) at++
    if (at >= html.length) return null
    if (html[at] === '>') return { attributes, end: at + 1 }
    const nameStart = at
    while (at < html.length && !SPACE.test(html[at]!) && !'=>/'.includes(html[at]!)) at++
    const name = html.slice(nameStart, at).toLowerCase()
    // A stray "=" would otherwise be read as an empty name over and over.
    if (at === nameStart) at++
    while (at < html.length && SPACE.test(html[at]!)) at++
    let value = ''
    if (html[at] === '=') {
      at++
      while (at < html.length && SPACE.test(html[at]!)) at++
      const quote = html[at]
      if (quote === '"' || quote === '\'') {
        const close = html.indexOf(quote, at + 1)
        if (close === -1) return null
        value = html.slice(at + 1, close)
        at = close + 1
      }
      else {
        const valueStart = at
        while (at < html.length && !SPACE.test(html[at]!) && html[at] !== '>') at++
        if (at >= html.length) return null
        value = html.slice(valueStart, at)
      }
    }
    // As in a browser, the first of two attributes with one name counts.
    if (name && !attributes.has(name)) attributes.set(name, decodeEntities(value))
  }
}

/**
 * The page without its comments, scripts and styles: what sits in those is not the page's own
 * markup. One that never closes takes the rest of the page with it, as in a browser. Each
 * character is looked at once: a pattern that searches on to the end of the page from every
 * opener takes seconds on a page made of openers, and nothing else is answered meanwhile.
 */
export function ownMarkup(html: string): string {
  const opener = /<!--|<(script|style)(?=[\s/>])/gi
  let markup = ''
  let from = 0
  for (let match = opener.exec(html); match; match = opener.exec(html)) {
    markup += html.slice(from, match.index)
    let end = -1
    if (match[1]) {
      const closer = new RegExp(`</${match[1]}\\s*>`, 'gi')
      closer.lastIndex = opener.lastIndex
      if (closer.exec(html)) end = closer.lastIndex
    }
    else {
      const at = html.indexOf('-->', opener.lastIndex)
      if (at >= 0) end = at + 3
    }
    if (end < 0) return markup
    from = opener.lastIndex = end
  }
  return markup + html.slice(from)
}

/**
 * The address of the picture a page gives as its cover, or null: its `og:image`, else
 * `og:image:secure_url`, `twitter:image` or `<link rel="image_src">`, made absolute against
 * `base`, the address the page was fetched from. Only http and https addresses count, so a
 * `data:` or `javascript:` one is never returned.
 */
export function coverAddress(html: string, base: string): string | null {
  const markup = ownMarkup(html)
  const found = new Map<string, string[]>()
  const tag = /<(meta|link)(?=[\s/>])/gi
  for (let match = tag.exec(markup); match; match = tag.exec(markup)) {
    const parsed = attributesAt(markup, tag.lastIndex)
    if (!parsed) break
    tag.lastIndex = parsed.end
    const { attributes } = parsed
    const meta = match[1]!.toLowerCase() === 'meta'
    const name = meta
      ? (attributes.get('property') ?? attributes.get('name'))?.trim().toLowerCase()
      : attributes.get('rel')?.trim().toLowerCase()
    const value = attributes.get(meta ? 'content' : 'href')
    if (!name || value === undefined) continue
    found.set(name, [...(found.get(name) ?? []), value])
  }
  for (const name of [...COVER_NAMES, 'image_src']) {
    for (const value of found.get(name) ?? []) {
      // An empty address would resolve to the page itself.
      if (!value.trim()) continue
      try {
        const address = new URL(value.trim(), base)
        if (address.protocol === 'http:' || address.protocol === 'https:') return address.href
      }
      catch { /* not an address: on to the next one */ }
    }
  }
  return null
}

/**
 * The cover of the page at `address`: the page is fetched, the picture it names is fetched,
 * and its first bytes must say JPEG, PNG or WebP. Throws a `FetchError` with the reason when
 * any step fails. The site uses `fetchCover`, which keeps the reason to itself.
 */
export async function loadCover(address: string, options: Partial<CoverOptions> = {}): Promise<Cover> {
  return withinTime(options, async (fetching) => {
    const page = await guardedGet(address, undefined, 'page', fetching)
    const cover = coverAddress(page.data.toString('utf8'), page.url.href)
    if (!cover) throw new FetchError('no_cover')
    return pictureAt(cover, fetching)
  })
}

/** The cover of the page at `address`, or null when there is none to be had, whatever the reason. Never throws. */
export async function fetchCover(address: string, options: Partial<CoverOptions> = {}): Promise<Cover | null> {
  return loadCover(address, options).catch(() => null)
}

// ── Putting it on a wish ─────────────────────────────────────────────────────────────────────

/** How many covers one account may have fetched in `COVER_WINDOW_MS`. */
export const COVER_FETCHES = 30
const COVER_WINDOW_MS = 10 * 60 * 1000
/** How long a request waits for a cover before it answers without one. */
const COVER_BUDGET_MS = 6000

/**
 * Fetches the cover of `address`, the wish's first link, and makes it the wish's picture.
 * Answers with the wish as it is then, or with null when nothing changed: no cover, too many
 * fetches by this account lately, or the wish moved on meanwhile. It never throws and never
 * says why, and it answers within `budgetMs` whatever the shop does; a cover that still comes
 * in after that is kept for the next time the list is opened.
 */
export async function refreshCover(
  db: Db,
  userId: number,
  token: string,
  wishId: number,
  address: string,
  fetcher: (address: string) => Promise<Cover | null> = fetchCover,
  budgetMs = COVER_BUDGET_MS,
): Promise<PublicWish | null> {
  const key = `cover:${userId}`
  if (isLimited(key, COVER_FETCHES)) return null
  countHit(key, COVER_WINDOW_MS)

  const step = async (): Promise<PublicWish | null> => {
    const cover = await fetcher(address)
    return cover ? keepCover(db, userId, token, wishId, address, cover) : null
  }
  return atLatest(step().catch(() => null), budgetMs)
}

/** Saves a fetched cover and makes it the wish's picture. Null when the wish moved on meanwhile; the file is then not kept. */
async function keepCover(db: Db, userId: number, token: string, wishId: number, address: string, cover: Cover): Promise<PublicWish | null> {
  const name = await saveUpload(cover.data, cover.ext)
  try {
    const { wish, unused } = setWishCover(db, userId, token, wishId, address, name)
    await removeUploads(unused)
    return wish
  }
  catch {
    // The wish is gone or no longer theirs: don't keep the file.
    await removeUpload(name).catch(() => {})
    return null
  }
}

/** What `work` gives, or null once `budgetMs` is over. `work` goes on either way. */
async function atLatest<T>(work: Promise<T>, budgetMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, budgetMs, null)
  })
  try {
    return await Promise.race([work, waited])
  }
  finally {
    clearTimeout(timer)
  }
}

// ── The pictures of an import ────────────────────────────────────────────────────────────────

/** An imported wish and where its picture comes from: the one the shop's list showed, or else the cover of its page. */
export interface ImportedCover { wishId: number, url: string, image?: string }

/** Every import's pictures wait here for the ones before them. */
let importing: Promise<void> = Promise.resolve()

/**
 * Fetches the pictures of wishes that were just imported, one at a time, and one import after
 * another across the whole site: a hundred wishes are a hundred shops to ask, and the lookups
 * and the home connection are shared with everything else. Answers when they are all in or
 * `budgetMs` is over, whichever comes first; the rest go on and show when the list is next
 * opened. It never throws, and a picture that can't be had is left out.
 */
export function coverImported(
  db: Db,
  userId: number,
  token: string,
  wanted: readonly ImportedCover[],
  fetchers: { page: (address: string) => Promise<Cover | null>, image: (address: string) => Promise<Cover | null> } = { page: fetchCover, image: fetchPicture },
  budgetMs = COVER_BUDGET_MS,
): Promise<void> {
  const work = async () => {
    for (const { wishId, url, image } of wanted) {
      try {
        const cover = await (image ? fetchers.image(image) : fetchers.page(url))
        if (cover) await keepCover(db, userId, token, wishId, url, cover)
      }
      catch { /* this one stays without a picture */ }
    }
  }
  const mine = importing.then(work)
  importing = mine
  return atLatest(mine, budgetMs).then(() => {})
}
