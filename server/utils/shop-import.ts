import { WISH_TITLE_MAX } from '../../shared/utils/wish-edit'
import { IMPORT_MAX, type ImportItem, type ImportRead } from '../../shared/utils/wish-import'
import { type Fetching, type FetchOptions, guardedGet, remembering, sooner, strictPolicy, withinTime } from './guarded-fetch'
import { attributesAt, decodeEntities, ownMarkup } from './link-cover'

// Reading wishes from a shop, for someone who pastes links on their own list: a wishlist they
// share at bol.com or Amazon, read whole, or the pages of single products at any shop, read for
// their name. Every request goes out the way a cover's does (guarded-fetch.ts), under the site's
// own name, without cookies. What a shop refuses is left out and reported as unread; nothing
// here poses as a browser to get it anyway. bol.com is such a shop for the pages of its
// products (it answered them with "access blocked" in November 2026) while the page of a shared
// wishlist answers, so a wish from there takes its picture from the list and never from its page.

// ── Reading what a shop sent ─────────────────────────────────────────────────────────────────

/** A field, some levels down, of something a shop sent; undefined where it isn't shaped that way. */
function field(value: unknown, ...path: string[]): unknown {
  let at = value
  for (const key of path) {
    if (!at || typeof at !== 'object' || Array.isArray(at)) return undefined
    at = (at as Record<string, unknown>)[key]
  }
  return at
}

/** A name as a wish's title: on one line and no longer than a title can be. Null when there is none. */
function asTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value.replace(/\s+/g, ' ').trim()
  if (!title) return null
  if (title.length <= WISH_TITLE_MAX) return title
  // Not cut in the middle of a character that takes two places.
  return `${title.slice(0, WISH_TITLE_MAX - 1).replace(/[\uD800-\uDBFF]$/, '').trimEnd()}…`
}

/** An http(s) address a wish can carry as its link, made absolute against the page it came from. */
function asLink(value: unknown, base: string): URL | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim(), base)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.href.length <= 2000 ? url : null
  }
  catch {
    return null
  }
}

/** One page of a shop's list: its wishes, how many the whole list holds when the shop says, and what leads to the next page. */
export interface ShopPage { items: ImportItem[], total: number | null, next: string | null }

// ── The links in a paste ─────────────────────────────────────────────────────────────────────

/** The http(s) addresses in a pasted text, in its order, each once, and no more than an import brings. */
export function linksIn(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    // What closes a sentence or a bracket around a link isn't part of it.
    const link = asLink(match[0].replace(/[.,;:!?)\]}]+$/, ''), match[0])
    if (!link || found.includes(link.href)) continue
    found.push(link.href)
    if (found.length === IMPORT_MAX) break
  }
  return found
}

/** A wishlist someone keeps at a shop: the page that shows it to anyone who has its link. */
export type ShopList
  = | { shop: 'bol', page: string, id: string, api: string }
    | { shop: 'amazon', page: string }

const BOL_LIST = /^\/(nl|be)\/nl\/(?:lijstjes\/)?verlanglijstje\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i
const AMAZON_HOST = /^(?:www\.)?amazon\.(?:nl|com\.be|de|fr|co\.uk|com|es|it)$/
const AMAZON_LIST = /\/hz\/wishlist\/ls\/([A-Z0-9]{6,20})(?:\/|$)/

/**
 * Whether a link is a wishlist at a shop whose lists can be read. For bol.com the address its
 * owner sees (`/lijstjes/verlanglijstje/…`) counts too: the list has the same id on the page
 * bol.com shows to others, and that page is the one that is fetched.
 */
export function shopListOf(link: URL): ShopList | null {
  const host = link.hostname.toLowerCase()
  if (host === 'www.bol.com' || host === 'bol.com') {
    const list = BOL_LIST.exec(link.pathname)
    if (!list) return null
    const id = list[2]!.toLowerCase()
    return { shop: 'bol', id, page: `https://www.bol.com/${list[1]!.toLowerCase()}/nl/verlanglijstje/${id}/`, api: 'https://www.bol.com/api/graphql' }
  }
  if (AMAZON_HOST.test(host)) {
    const list = AMAZON_LIST.exec(link.pathname)
    return list ? { shop: 'amazon', page: `https://${host.replace(/^(?!www\.)/, 'www.')}/hz/wishlist/ls/${list[1]}` } : null
  }
  return null
}

// ── bol.com ──────────────────────────────────────────────────────────────────────────────────

/**
 * What bol.com's page hands its own scripts: the texts of `streamController.enqueue("…")`,
 * joined. Its first line is the page's data, flattened (see `unflattened`).
 */
function routerData(html: string): unknown[] | null {
  let stream = ''
  for (const match of html.matchAll(/streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g)) {
    try {
      stream += JSON.parse(match[1]!)
    }
    catch {
      return null
    }
  }
  try {
    const values: unknown = JSON.parse(stream.split('\n', 1)[0]!)
    return Array.isArray(values) ? values : null
  }
  catch {
    return null
  }
}

/**
 * The data React Router flattened into `values` (its "turbo-stream" format): every value sits
 * once in the list, the first is the root, and an object or an array holds the places of its
 * parts. An object's keys are places too, written `_12`. A negative place is a value that isn't
 * there (-5 is null); an array that starts with a text is one of the format's own types (a
 * date, a promise), which a wishlist's data doesn't need and reads as nothing here.
 */
function unflattened(values: unknown[]): unknown {
  const done = new Map<number, unknown>()
  const at = (place: unknown, depth: number): unknown => {
    if (typeof place !== 'number' || !Number.isInteger(place) || place >= values.length || depth > 40) return undefined
    if (place < 0) return place === -5 ? null : undefined
    if (done.has(place)) return done.get(place)
    const value = values[place]
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string') return undefined
      const list: unknown[] = []
      done.set(place, list)
      for (const part of value) list.push(at(part, depth + 1))
      return list
    }
    if (value && typeof value === 'object') {
      // Without a prototype: the keys come from someone else's page.
      const object: Record<string, unknown> = Object.create(null)
      done.set(place, object)
      for (const [key, part] of Object.entries(value)) {
        const name = values[Number(key.slice(1))]
        if (key.startsWith('_') && typeof name === 'string') object[name] = at(part, depth + 1)
      }
      return object
    }
    return value
  }
  return at(0, 0)
}

/** The picture bol.com's list shows of a product: the widest it names, from bol.com's own picture host. */
function bolPicture(assets: unknown, base: string): string | null {
  const renditions = field(Array.isArray(assets) ? assets[0] : null, 'renditions')
  if (!Array.isArray(renditions)) return null
  let widest: { url: URL, width: number } | null = null
  for (const rendition of renditions.slice(0, 20)) {
    const url = asLink(field(rendition, 'url'), base)
    const width = field(rendition, 'width')
    if (!url || url.protocol !== 'https:' || !/(^|\.)s-bol\.com$/.test(url.hostname)) continue
    if (!widest || (typeof width === 'number' && width > widest.width)) widest = { url, width: typeof width === 'number' ? width : 0 }
  }
  return widest ? widest.url.href : null
}

/** The wishes in a wishlist as bol.com's own data has it, the same on its page and from its API. */
function bolWishlist(wishlist: unknown, base: string): ShopPage | null {
  const edges = field(wishlist, 'items', 'edges')
  if (!Array.isArray(edges)) return null
  const items: ImportItem[] = []
  for (const edge of edges) {
    const product = field(edge, 'node', 'product')
    const title = asTitle(field(product, 'title'))
    const url = asLink(field(product, 'url'), base)
    const image = bolPicture(field(product, 'assets'), base)
    if (title && url) items.push(image ? { title, url: url.href, image } : { title, url: url.href })
  }
  const total = field(wishlist, 'productsTotal')
  const cursor = field(wishlist, 'items', 'pageInfo', 'endCursor')
  return {
    items,
    total: typeof total === 'number' && Number.isInteger(total) && total >= 0 ? total : null,
    next: field(wishlist, 'items', 'pageInfo', 'hasNextPage') === true && typeof cursor === 'string' && cursor ? cursor : null,
  }
}

/** The first page of a wishlist someone shares at bol.com, from the page's own data. Null when the page isn't one. */
export function bolList(html: string, base: string): ShopPage | null {
  const values = routerData(html)
  return values ? bolWishlist(field(unflattened(values), 'loaderData', 'routes/wishlist-public', 'wishlist'), base) : null
}

/**
 * The query bol.com's page sends for the items after its first 24 (`PublicWishlist` in its
 * script `clientQueries`, read on 2026-11-21). bol.com names a query by this id and gives it a
 * new one when the query changes; the API then refuses this one and an import keeps what the
 * page itself held.
 */
const BOL_MORE = 'sha256:28883ddc8b69a9033fa05f34ce7860d63e91cc1492760a6fe7b919f46921032c'
const BOL_PAGE_SIZE = 24

/** What is sent to bol.com's API for the items after `cursor`. */
export function bolMoreRequest(id: string, cursor: string): string {
  return JSON.stringify({ documentId: BOL_MORE, variables: { wishlistId: id, numberOfProducts: BOL_PAGE_SIZE, cursor } })
}

/** The wishlist in an answer of bol.com's API, wherever it sits in the answer's data. Null when there is none. */
export function bolMore(json: string, base: string): ShopPage | null {
  let answer: unknown
  try {
    answer = JSON.parse(json)
  }
  catch {
    return null
  }
  // The field the query puts it under isn't known here, so it is looked for by its shape.
  const search = (value: unknown, depth: number): ShopPage | null => {
    if (!value || typeof value !== 'object' || depth > 4) return null
    const page = bolWishlist(value, base)
    if (page) return page
    for (const part of Object.values(value).slice(0, 50)) {
      const found = search(part, depth + 1)
      if (found) return found
    }
    return null
  }
  return search(field(answer, 'data'), 0)
}

// ── Amazon ───────────────────────────────────────────────────────────────────────────────────

/** A product's own address at Amazon, without what the list added to it. */
function amazonProduct(href: unknown, base: string): string | null {
  const url = asLink(href, base)
  if (!url) return null
  const product = /\/dp\/([A-Z0-9]{10})(?:\/|$)/.exec(url.pathname)
  return product ? `${url.origin}/dp/${product[1]}` : `${url.origin}${url.pathname}`
}

/** The list's small picture of a product, asked for larger: Amazon sizes a picture by the code before its extension. */
function amazonPicture(src: unknown, base: string): string | null {
  const url = asLink(src, base)
  if (!url || !/(^|\.)media-amazon\.com$/.test(url.hostname) || !url.pathname.startsWith('/images/I/')) return null
  return url.href.replace(/\._[^./]+_\.(jpe?g|png|webp)$/i, '._SL500_.$1')
}

/**
 * One page of a wishlist someone shares at Amazon, or the items a later page adds: each item's
 * name and address from its `itemName_…` link, its picture from the `itemImage_…` block before
 * it. `next` is the address the page itself would fetch when scrolled to the end, until the
 * page carries the mark that ends the list.
 */
export function amazonList(html: string, base: string): ShopPage {
  const markup = ownMarkup(html)
  const pictures = new Map<string, string>()
  const items: ImportItem[] = []
  let picturing: string | null = null
  let more: string | undefined
  const tag = /<(a|div|img|input)(?=[\s/>])/gi
  for (let match = tag.exec(markup); match; match = tag.exec(markup)) {
    const parsed = attributesAt(markup, tag.lastIndex)
    if (!parsed) break
    tag.lastIndex = parsed.end
    const { attributes } = parsed
    const id = attributes.get('id') ?? ''
    switch (match[1]!.toLowerCase()) {
      case 'div':
        if (id.startsWith('itemImage_')) picturing = id.slice('itemImage_'.length)
        break
      case 'img': {
        const picture = picturing && !pictures.has(picturing) ? amazonPicture(attributes.get('src'), base) : null
        if (picture) pictures.set(picturing!, picture)
        break
      }
      case 'a': {
        if (!id.startsWith('itemName_')) break
        const title = asTitle(attributes.get('title'))
        const url = amazonProduct(attributes.get('href'), base)
        const image = pictures.get(id.slice('itemName_'.length))
        if (title && url) items.push(image ? { title, url, image } : { title, url })
        break
      }
      case 'input':
        if (attributes.get('name') === 'showMoreUrl') more ??= attributes.get('value')
    }
  }
  const ended = /\bid\s*=\s*["']?endOfListMarker\b/i.test(markup)
  const next = ended ? null : asLink(more, base)
  // Only Amazon's own next page, on the site the list is at.
  return { items, total: null, next: next && next.host === new URL(base).host && next.pathname.startsWith('/hz/wishlist/') ? next.href : null }
}

/** What Amazon's page of a product calls it: the text of its `productTitle`. The page's `<title>` adds the author and the shop to it. */
function amazonTitle(html: string): string | null {
  const markup = ownMarkup(html)
  const tag = /<span(?=[\s/>])/gi
  for (let match = tag.exec(markup); match; match = tag.exec(markup)) {
    const parsed = attributesAt(markup, tag.lastIndex)
    if (!parsed) break
    tag.lastIndex = parsed.end
    if (parsed.attributes.get('id') !== 'productTitle') continue
    const end = markup.indexOf('<', parsed.end)
    return asTitle(decodeEntities(markup.slice(parsed.end, end < 0 ? undefined : end)))
  }
  return null
}

// ── The page of one product ──────────────────────────────────────────────────────────────────

const PRODUCT_TYPES = new Set(['product', 'productgroup', 'individualproduct', 'book'])

/** The name of the product a page describes to search engines (JSON-LD), or null. */
function productName(html: string): string | null {
  const named = (data: unknown, depth: number): string | null => {
    if (!data || typeof data !== 'object' || depth > 3) return null
    if (Array.isArray(data)) {
      for (const part of data.slice(0, 50)) {
        const name = named(part, depth + 1)
        if (name) return name
      }
      return null
    }
    const types = [field(data, '@type')].flat().filter(type => typeof type === 'string').map(type => type.toLowerCase())
    const name = field(data, 'name')
    if (types.some(type => PRODUCT_TYPES.has(type)) && typeof name === 'string') return asTitle(decodeEntities(name))
    return named(field(data, '@graph'), depth + 1) ?? named(field(data, 'mainEntity'), depth + 1)
  }
  // Each script is skipped as a whole, so every character of the page is looked at once.
  const opener = /<script(?=[\s/>])/gi
  const closer = /<\/script\s*>/gi
  let read = 0
  for (let match = opener.exec(html); match && read < 20; match = opener.exec(html)) {
    const parsed = attributesAt(html, opener.lastIndex)
    if (!parsed) break
    closer.lastIndex = parsed.end
    const close = closer.exec(html)
    if (!close) break
    opener.lastIndex = closer.lastIndex
    if (parsed.attributes.get('type')?.trim().toLowerCase() !== 'application/ld+json') continue
    read++
    try {
      const name = named(JSON.parse(html.slice(parsed.end, close.index)), 0)
      if (name) return name
    }
    catch { /* not JSON after all: on to the next one */ }
  }
  return null
}

/**
 * What a product's page calls the product: its name in the page's JSON-LD, else the page's
 * `og:title` or `twitter:title`, else its `<title>`. Null when the page names nothing.
 */
export function pageTitle(html: string): string | null {
  const product = productName(html)
  if (product) return product
  const markup = ownMarkup(html)
  const found = new Map<string, string>()
  const tag = /<meta(?=[\s/>])/gi
  for (let match = tag.exec(markup); match; match = tag.exec(markup)) {
    const parsed = attributesAt(markup, tag.lastIndex)
    if (!parsed) break
    tag.lastIndex = parsed.end
    const name = (parsed.attributes.get('property') ?? parsed.attributes.get('name'))?.trim().toLowerCase()
    const value = parsed.attributes.get('content')
    if (name && value !== undefined && !found.has(name)) found.set(name, value)
  }
  const title = /<title(?=[\s/>])[^>]*>([^<]*)/i.exec(markup)
  return asTitle(found.get('og:title')) ?? asTitle(found.get('twitter:title')) ?? asTitle(title ? decodeEntities(title[1]!) : null)
}

// ── Reading a paste ──────────────────────────────────────────────────────────────────────────

export interface ImportOptions extends Partial<FetchOptions> {
  /** How long one page may take, inside the time for the whole paste. */
  perFetchMs?: number
  /** Which links are a shop's wishlist. The tests point this at a shop they run themselves. */
  recognise?: (link: URL) => ShopList | null
}

/** For the whole paste. Someone is waiting for the answer. */
const IMPORT_MS = 25_000
/** A shop's list of wishes is a longer page than the head a cover is read from. */
const IMPORT_PAGE_BYTES = 2 * 1024 * 1024
const PER_FETCH_MS = 8000
/** How many pages are asked for after a list's first. */
const MORE_PAGES = 12
/** How many product pages are out at once. */
const AT_ONCE = 4

interface ListRead { items: ImportItem[], total: number | null, complete: boolean }

/** A whole list at a shop, page after page, as far as the shop gives it. Null when its first page shows no wishes. */
async function readList(list: ShopList, fetching: Fetching, perFetchMs: number): Promise<ListRead | null> {
  const fetched = await guardedGet(list.page, undefined, 'page', sooner(fetching, perFetchMs))
  const base = fetched.url.href
  const html = fetched.data.toString('utf8')
  const first = list.shop === 'bol' ? bolList(html, base) : amazonList(html, base)
  if (!first?.items.length) return null
  const items = [...first.items]
  let next = first.next
  for (let pages = 0; next && items.length < IMPORT_MAX && pages < MORE_PAGES; pages++) {
    let more: ShopPage | null = null
    try {
      if (list.shop === 'bol') {
        const answer = await guardedGet(list.api, undefined, 'json', sooner(fetching, perFetchMs), bolMoreRequest(list.id, next))
        more = bolMore(answer.data.toString('utf8'), base)
      }
      else {
        const answer = await guardedGet(next, undefined, 'page', sooner(fetching, perFetchMs))
        more = amazonList(answer.data.toString('utf8'), answer.url.href)
      }
    }
    catch { /* the shop refused or took too long: what was read so far is kept */ }
    // A page that brings nothing new, or leads back to itself, would be asked for again and again.
    if (!more?.items.length || more.next === next) break
    items.push(...more.items)
    next = more.next
  }
  return { items: items.slice(0, IMPORT_MAX), total: first.total, complete: next === null && items.length <= IMPORT_MAX }
}

/** The product a page is about, as a wish with that page as its link. Null when the page names nothing. */
async function readProduct(link: string, fetching: Fetching): Promise<ImportItem | null> {
  const page = await guardedGet(link, undefined, 'page', fetching)
  const html = page.data.toString('utf8')
  const title = (AMAZON_HOST.test(page.url.hostname) ? amazonTitle(html) : null) ?? pageTitle(html)
  return title ? { title, url: link } : null
}

/**
 * The wishes behind the links in a pasted text, in the links' order: a shop's wishlist gives all
 * of its wishes, any other link the product its page is about. It answers within about 25
 * seconds whatever the shops do, and never throws: a link nothing came of is in `unread`, and a
 * list that holds more than was read is told in `short`.
 */
export async function readImport(text: string, options: ImportOptions = {}): Promise<ImportRead> {
  const { recognise = shopListOf, perFetchMs = PER_FETCH_MS, ...fetch } = options
  const links = linksIn(text)
  const read: ({ items: ImportItem[], list?: ListRead } | null)[] = links.map(() => null)
  if (links.length) {
    // One name is looked up once for the whole paste, however many of its links are at that shop.
    const settings = { timeoutMs: IMPORT_MS, maxPageBytes: IMPORT_PAGE_BYTES, ...fetch, policy: remembering(fetch.policy ?? strictPolicy) }
    await withinTime(settings, async (fetching) => {
      const products: number[] = []
      // The lists first and one at a time: each is several requests to one shop.
      for (const [at, link] of links.entries()) {
        const list = recognise(new URL(link))
        if (!list) {
          products.push(at)
          continue
        }
        const found = await readList(list, fetching, perFetchMs).catch(() => null)
        if (found) read[at] = { items: found.items, list: found }
      }
      let next = 0
      const worker = async () => {
        while (next < products.length) {
          const at = products[next++]!
          const item = await readProduct(links[at]!, sooner(fetching, perFetchMs)).catch(() => null)
          if (item) read[at] = { items: [item] }
        }
      }
      await Promise.all(Array.from({ length: AT_ONCE }, worker))
    }).catch(() => {})
  }

  const items: ImportItem[] = []
  const unread: string[] = []
  const seen = new Set<string>()
  let short: ImportRead['short'] = null
  links.forEach((link, at) => {
    const found = read[at]
    if (!found) return void unread.push(link)
    let kept = 0
    for (const item of found.items) {
      if (seen.has(item.url)) continue
      if (items.length === IMPORT_MAX) break
      seen.add(item.url)
      items.push(item)
      kept++
    }
    // A list is short when the shop kept some of it back, or when the import was full.
    if (found.list && (!found.list.complete || items.length === IMPORT_MAX && kept < found.items.length)) {
      short = { read: (short?.read ?? 0) + kept, total: short && short.total === null ? null : found.list.total === null ? null : (short?.total ?? 0) + found.list.total }
    }
  })
  return { items, unread, short }
}
