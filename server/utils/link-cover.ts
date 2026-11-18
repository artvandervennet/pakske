import { lookup } from 'node:dns/promises'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { isIP, isIPv6 } from 'node:net'
import type { PublicWish } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { setWishCover } from '../domain/wishes'
import { countHit, isLimited } from './rate-limit'
import { removeUpload, removeUploads, saveUpload, sniffImage, UPLOAD_MAX_BYTES, type UploadExt } from './uploads'

// The picture a shop's page names as its own (og:image and the like), fetched by the server for
// the first link of a wish. The server sits on someone's home network and fetches addresses that
// people type, so every request here is hemmed in: public addresses only, checked before
// connecting and again on every redirect, with a hard limit on time and size. Nothing of the
// visitor's request goes along, and nothing of the shop's answer comes back but the picture.

// ── Which addresses the server may connect to ────────────────────────────────────────────────

/** IPv4 ranges that are not the public internet, as [first address, bits that count]. */
const CLOSED_V4: readonly [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared by a provider's customers
  ['127.0.0.0', 8], // this machine
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarks
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and 255.255.255.255
]

/** A dotted IPv4 address as one number, or null. Only plain decimals: "010.0.0.1" could be read two ways. */
function ipv4Number(ip: string): number | null {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!parts) return null
  let number = 0
  for (const part of parts.slice(1)) {
    if ((part.length > 1 && part.startsWith('0')) || Number(part) > 255) return null
    number = number * 256 + Number(part)
  }
  return number
}

function isPublicV4(number: number): boolean {
  return !CLOSED_V4.some(([first, bits]) => {
    const size = 2 ** (32 - bits)
    return Math.floor(number / size) === Math.floor(ipv4Number(first)! / size)
  })
}

/** An IPv6 address as its eight groups, or null. One with a zone ("%eth0") names a local link and is refused. */
function ipv6Groups(ip: string): number[] | null {
  if (!isIPv6(ip) || ip.includes('%')) return null
  let text = ip
  // The last 32 bits may be written as an IPv4 address.
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (tail) {
    const v4 = ipv4Number(tail[2]!)
    if (v4 === null) return null
    text = `${tail[1]}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`
  }
  const [head, rest, ...more] = text.split('::')
  if (more.length > 0) return null
  const groups = (part: string | undefined) => part ? part.split(':').map(group => Number.parseInt(group, 16)) : []
  const start = groups(head)
  const end = groups(rest)
  const all = rest === undefined ? start : [...start, ...Array.from({ length: 8 - start.length - end.length }, () => 0), ...end]
  return all.length === 8 && all.every(group => group >= 0 && group <= 0xFFFF) ? all : null
}

/**
 * Whether an address is on the public internet, so the server may connect to it. Everything
 * else is refused: this machine, the home network, link-local and other special ranges, and
 * whatever doesn't read as a plain IPv4 or IPv6 address.
 */
export function isPublicAddress(ip: string): boolean {
  const v4 = ipv4Number(ip)
  if (v4 !== null) return isPublicV4(v4)
  const groups = ipv6Groups(ip)
  if (!groups) return false
  const [a, b, c, d, e, f, g, h] = groups as [number, number, number, number, number, number, number, number]
  // ::ffff:a.b.c.d is an IPv4 address in IPv6 clothes: it goes where that address goes.
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xFFFF) return isPublicV4(g * 65536 + h)
  // Public IPv6 is 2000::/3. That leaves out ::, ::1, 64:ff9b::/96 (IPv4 behind a translator),
  // fc00::/7 (private), fe80::/10 (link-local) and ff00::/8 (multicast) without naming them.
  if (a < 0x2000 || a > 0x3FFF) return false
  // Within it: 2001:db8::/32 and 3fff::/20 are for documentation, 2001::/23 holds tunnels and
  // other special uses, and 2002::/16 (6to4) carries an IPv4 address, which decides.
  if (a === 0x2001 && b === 0x0DB8) return false
  if (a === 0x3FFF && b < 0x1000) return false
  if (a === 0x2001 && b < 0x0200) return false
  if (a === 0x2002) return isPublicV4(b * 65536 + c)
  return true
}

// ── What a page names as its cover ───────────────────────────────────────────────────────────

/** Where a page may name its cover, the first that gives a usable address wins. */
const COVER_NAMES = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'] as const

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }

/** An attribute's value with its character references read: `&amp;`, `&#38;`, `&#x26;`. Others stay as written. */
function decodeEntities(text: string): string {
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
function attributesAt(html: string, from: number): { attributes: Map<string, string>, end: number } | null {
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
function ownMarkup(html: string): string {
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

// ── Fetching ─────────────────────────────────────────────────────────────────────────────────

/**
 * What the fetch is allowed to reach. The site only ever uses `strictPolicy`; the tests pass
 * one that lets them reach a shop they run on this machine.
 */
export interface FetchPolicy {
  /** Every address a host name has. */
  resolve: (host: string) => Promise<string[]>
  /** Whether the server may connect to this address. A name is refused when any of its addresses is. */
  allowsAddress: (ip: string) => boolean
  /** Whether a port may be used, as `URL` gives it: empty for the scheme's own (80, 443). */
  allowsPort: (port: string) => boolean
}

/** Public addresses only, on the ports the web uses. */
export const strictPolicy: FetchPolicy = {
  resolve: async host => (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address),
  allowsAddress: isPublicAddress,
  allowsPort: port => port === '',
}

export interface CoverOptions {
  policy: FetchPolicy
  /** For the page, its redirects and the picture together. */
  timeoutMs: number
  /** Per address: the page's, and the picture's. */
  maxRedirects: number
  /** How much of the page is read. The cover is named in the head, so the rest isn't needed. */
  maxPageBytes: number
  maxImageBytes: number
}

const DEFAULTS: CoverOptions = {
  policy: strictPolicy,
  timeoutMs: 5000,
  maxRedirects: 3,
  maxPageBytes: 512 * 1024,
  maxImageBytes: UPLOAD_MAX_BYTES,
}

/** Why a cover wasn't fetched. For the tests and for whoever debugs; it never leaves the server. */
export type CoverFailure
  = | 'address' // not http(s), a login in it, or another port
    | 'private' // it leads somewhere that isn't the public internet
    | 'redirects'
    | 'timeout'
    | 'network'
    | 'status'
    | 'type' // the page isn't HTML
    | 'too_large'
    | 'no_cover' // the page names no picture
    | 'not_image' // the picture isn't a JPEG, PNG or WebP

export class CoverError extends Error {
  constructor(public readonly reason: CoverFailure) {
    super(reason)
    this.name = 'CoverError'
  }
}

export interface Cover { data: Buffer, ext: UploadExt }

const USER_AGENT = 'Pakske link preview'
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const PAGE_TYPES = new Set(['text/html', 'application/xhtml+xml'])

interface Fetching { options: CoverOptions, signal: AbortSignal }
type Kind = 'page' | 'image'

/** The address, if the server may ask for it at all: http or https, no login in it, an allowed port. */
function checked(address: string, base: URL | undefined, policy: FetchPolicy): URL {
  let url: URL
  try {
    url = new URL(address, base)
  }
  catch {
    throw new CoverError('address')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new CoverError('address')
  if (url.username || url.password || !policy.allowsPort(url.port)) throw new CoverError('address')
  return url
}

/** Waits for `promise`, but no longer than the fetch's time. */
function inTime<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new CoverError('timeout'))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * The one address to connect to for this host, after checking every address the host has. A
 * host written as an address (`new URL` has already turned 2130706433, 0x7f.1 and the like into
 * dotted decimals) is checked the same way.
 */
async function pinned(url: URL, { options, signal }: Fetching): Promise<{ host: string, address: string, family: 4 | 6 }> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: string[]
  if (isIP(host)) {
    addresses = [host]
  }
  else {
    try {
      addresses = await inTime(options.policy.resolve(host), signal)
    }
    catch (error) {
      throw error instanceof CoverError ? error : new CoverError('network')
    }
  }
  if (addresses.length === 0) throw new CoverError('network')
  if (!addresses.every(address => isIP(address) !== 0 && options.policy.allowsAddress(address))) throw new CoverError('private')
  return { host, address: addresses[0]!, family: isIP(addresses[0]!) as 4 | 6 }
}

/** Sends one GET to the address that was checked, and answers with the response once its headers are in. */
function send(url: URL, to: { host: string, address: string, family: 4 | 6 }, kind: Kind, { signal }: Fetching): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request({
      method: 'GET',
      host: to.host,
      path: `${url.pathname}${url.search}`,
      port: url.port || undefined,
      // The connection goes to the address that was just checked. Asking the name again here
      // could get another answer (DNS rebinding), one that points into the home network.
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [{ address: to.address, family: to.family }])
        else callback(null, to.address, to.family)
      },
      // A certificate is still checked against the name, and the shop still gets asked by name.
      servername: isIP(to.host) ? undefined : to.host,
      // A connection of its own, closed afterwards: nothing is kept open or shared between fetches.
      agent: false,
      signal,
      // Only these. No cookie, no login, nothing from the request of whoever saved the link.
      headers: {
        'Host': url.host,
        'User-Agent': USER_AGENT,
        'Accept': kind === 'page' ? 'text/html,application/xhtml+xml' : 'image/jpeg,image/png,image/webp',
        // Packed answers would need unpacking with a limit of its own; shops send plain ones when asked.
        'Accept-Encoding': 'identity',
        'Connection': 'close',
      },
    }, (response) => {
      // A response whose connection is cut reports that as an error; unheard, it would stop the server.
      response.on('error', () => {})
      resolve(response)
    })
    request.on('error', () => reject(new CoverError(signal.aborted ? 'timeout' : 'network')))
    request.end()
  })
}

/**
 * The body, up to `limit` bytes. A page that is longer is cut off there; a picture that is
 * longer is refused, by its stated length when it has one and otherwise while it comes in.
 */
function body(response: IncomingMessage, limit: number, kind: Kind, { signal }: Fetching): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stated = Number(response.headers['content-length'])
    if (kind === 'image' && Number.isFinite(stated) && stated > limit) {
      response.destroy()
      return reject(new CoverError('too_large'))
    }
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (outcome: Buffer | CoverError) => {
      if (done) return
      done = true
      response.destroy()
      if (outcome instanceof CoverError) reject(outcome)
      else resolve(outcome)
    }
    response.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      size += chunk.length
      if (size <= limit) return
      if (kind === 'image') finish(new CoverError('too_large'))
      else finish(Buffer.concat(chunks).subarray(0, limit))
    })
    response.on('end', () => finish(Buffer.concat(chunks)))
    response.on('error', () => finish(new CoverError(signal.aborted ? 'timeout' : 'network')))
    // A connection that closes before the end leaves half an answer.
    response.on('close', () => finish(new CoverError(signal.aborted ? 'timeout' : 'network')))
  })
}

/** Fetches one address, following its redirects by hand so each one gets every check again. */
async function get(address: string, base: URL | undefined, kind: Kind, fetching: Fetching): Promise<{ url: URL, data: Buffer }> {
  const { options } = fetching
  let url = checked(address, base, options.policy)
  for (let redirects = 0; ; redirects++) {
    const response = await send(url, await pinned(url, fetching), kind, fetching)
    const status = response.statusCode ?? 0
    if (REDIRECTS.has(status)) {
      response.destroy()
      const location = response.headers.location
      if (!location) throw new CoverError('status')
      if (redirects >= options.maxRedirects) throw new CoverError('redirects')
      url = checked(location, url, options.policy)
      continue
    }
    if (status !== 200) {
      response.destroy()
      throw new CoverError('status')
    }
    if (kind === 'page') {
      const type = (response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
      const packed = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase() !== 'identity'
      if (!PAGE_TYPES.has(type) || packed) {
        response.destroy()
        throw new CoverError('type')
      }
    }
    const limit = kind === 'page' ? options.maxPageBytes : options.maxImageBytes
    return { url, data: await body(response, limit, kind, fetching) }
  }
}

/**
 * The cover of the page at `address`: the page is fetched, the picture it names is fetched,
 * and its first bytes must say JPEG, PNG or WebP. Throws a `CoverError` with the reason when
 * any step fails. The site uses `fetchCover`, which keeps the reason to itself.
 */
export async function loadCover(address: string, options: Partial<CoverOptions> = {}): Promise<Cover> {
  const controller = new AbortController()
  const fetching: Fetching = { options: { ...DEFAULTS, ...options }, signal: controller.signal }
  const timer = setTimeout(() => controller.abort(), fetching.options.timeoutMs)
  try {
    const page = await get(address, undefined, 'page', fetching)
    const cover = coverAddress(page.data.toString('utf8'), page.url.href)
    if (!cover) throw new CoverError('no_cover')
    const image = await get(cover, undefined, 'image', fetching)
    const ext = sniffImage(image.data)
    if (!ext) throw new CoverError('not_image')
    return { data: image.data, ext }
  }
  catch (error) {
    // Whatever else went wrong on the way counts as the network's doing.
    throw error instanceof CoverError ? error : new CoverError(controller.signal.aborted ? 'timeout' : 'network')
  }
  finally {
    clearTimeout(timer)
    // Ends whatever is still open.
    controller.abort()
  }
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
    if (!cover) return null
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
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, budgetMs, null)
  })
  try {
    return await Promise.race([step().catch(() => null), waited])
  }
  finally {
    clearTimeout(timer)
  }
}
