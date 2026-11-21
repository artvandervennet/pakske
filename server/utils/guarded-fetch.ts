import { lookup } from 'node:dns/promises'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { isIP, isIPv6 } from 'node:net'
import { sniffImage, UPLOAD_MAX_BYTES, type UploadExt } from './uploads'

// How the server fetches an address that someone typed: a shop's page, the picture that page
// names, a wishlist kept at a shop. The server sits on someone's home network, so every request
// here is hemmed in: public addresses only, checked before connecting and again on every
// redirect, with a hard limit on time and size. Nothing of the visitor's request goes along.

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

/**
 * `resolve`, with at most `max` lookups out at once: one more is refused without being started.
 * A lookup runs on one of Node's four threads, which file reads and the lookups for Firebase
 * share, and it can't be called off: a name whose nameserver never answers holds its thread long
 * after the fetch gave up waiting. Without a ceiling, a handful of such names stop the site
 * from serving pictures and logging people in.
 */
export function atMost(max: number, resolve: FetchPolicy['resolve']): FetchPolicy['resolve'] {
  let out = 0
  return async (host) => {
    if (out >= max) throw new Error('too many lookups out')
    out++
    try {
      return await resolve(host)
    }
    finally {
      out--
    }
  }
}

/** Public addresses only, on the ports the web uses. */
export const strictPolicy: FetchPolicy = {
  resolve: atMost(2, async host => (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address)),
  allowsAddress: isPublicAddress,
  allowsPort: port => port === '',
}

/**
 * `policy`, remembering what each name resolved to, so a hundred links to one shop cost one
 * lookup. It is made for one import and thrown away with it. Its lookups go out one after
 * another: an import never holds more than one of the lookups `atMost` leaves room for.
 */
export function remembering(policy: FetchPolicy): FetchPolicy {
  const known = new Map<string, Promise<string[]>>()
  let last: Promise<unknown> = Promise.resolve()
  return {
    ...policy,
    resolve: (host) => {
      let found = known.get(host)
      if (!found) {
        found = last.then(() => policy.resolve(host))
        last = found.catch(() => {})
        known.set(host, found)
        // A name that couldn't be looked up is asked again by the next link that has it.
        found.catch(() => known.delete(host))
      }
      return found
    },
  }
}

export interface FetchOptions {
  policy: FetchPolicy
  /** For everything one call fetches together: a page, its redirects and its picture. */
  timeoutMs: number
  /** Per address: the page's, and the picture's. */
  maxRedirects: number
  /** How much of a page is read. A cover is named in the head, so the rest isn't needed. */
  maxPageBytes: number
  maxImageBytes: number
}

const DEFAULTS: FetchOptions = {
  policy: strictPolicy,
  timeoutMs: 5000,
  maxRedirects: 3,
  maxPageBytes: 512 * 1024,
  maxImageBytes: UPLOAD_MAX_BYTES,
}

/** Why something wasn't fetched. For the tests and for whoever debugs; it never leaves the server. */
export type FetchFailure
  = | 'address' // not http(s), a login in it, or another port
    | 'private' // it leads somewhere that isn't the public internet
    | 'redirects'
    | 'timeout'
    | 'network'
    | 'status'
    | 'type' // the page isn't HTML, or the data isn't JSON
    | 'too_large'
    | 'no_cover' // the page names no picture
    | 'not_image' // the picture isn't a JPEG, PNG or WebP

export class FetchError extends Error {
  constructor(public readonly reason: FetchFailure) {
    super(reason)
    this.name = 'FetchError'
  }
}

export interface Cover { data: Buffer, ext: UploadExt }

const USER_AGENT = 'Pakske link preview'
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const PAGE_TYPES = new Set(['text/html', 'application/xhtml+xml'])
const JSON_TYPES = new Set(['application/json', 'application/graphql-response+json'])
const ACCEPT: Record<Kind, string> = {
  page: 'text/html,application/xhtml+xml',
  image: 'image/jpeg,image/png,image/webp',
  json: 'application/json',
}

/** One fetch under way: what it may do, and the signal that ends it when its time is over. */
export interface Fetching { options: FetchOptions, signal: AbortSignal }
/** What is asked for. A page that is too long is cut off; a picture or data that is too long is refused. */
export type Kind = 'page' | 'image' | 'json'

/** The address, if the server may ask for it at all: http or https, no login in it, an allowed port. */
function checked(address: string, base: URL | undefined, policy: FetchPolicy): URL {
  let url: URL
  try {
    url = new URL(address, base)
  }
  catch {
    throw new FetchError('address')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('address')
  if (url.username || url.password || !policy.allowsPort(url.port)) throw new FetchError('address')
  return url
}

/** Waits for `promise`, but no longer than the fetch's time. */
function inTime<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new FetchError('timeout'))
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
      throw error instanceof FetchError ? error : new FetchError('network')
    }
  }
  if (addresses.length === 0) throw new FetchError('network')
  if (!addresses.every(address => isIP(address) !== 0 && options.policy.allowsAddress(address))) throw new FetchError('private')
  return { host, address: addresses[0]!, family: isIP(addresses[0]!) as 4 | 6 }
}

/**
 * Sends one request to the address that was checked, and answers with the response once its
 * headers are in: a GET, or a POST of `post` as JSON.
 */
function send(url: URL, to: { host: string, address: string, family: 4 | 6 }, kind: Kind, { signal }: Fetching, post?: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request({
      method: post === undefined ? 'GET' : 'POST',
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
        'Accept': ACCEPT[kind],
        // Packed answers would need unpacking with a limit of its own; shops send plain ones when asked.
        'Accept-Encoding': 'identity',
        'Connection': 'close',
        ...(post === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(post)) }),
      },
    }, (response) => {
      // A response whose connection is cut reports that as an error; unheard, it would stop the server.
      response.on('error', () => {})
      resolve(response)
    })
    request.on('error', () => reject(new FetchError(signal.aborted ? 'timeout' : 'network')))
    request.end(post)
  })
}

/**
 * The body, up to `limit` bytes. A page that is longer is cut off there; a picture or data that
 * is longer is refused, by its stated length when it has one and otherwise while it comes in.
 */
function body(response: IncomingMessage, limit: number, kind: Kind, { signal }: Fetching): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stated = Number(response.headers['content-length'])
    if (kind !== 'page' && Number.isFinite(stated) && stated > limit) {
      response.destroy()
      return reject(new FetchError('too_large'))
    }
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (outcome: Buffer | FetchError) => {
      if (done) return
      done = true
      response.destroy()
      if (outcome instanceof FetchError) reject(outcome)
      else resolve(outcome)
    }
    response.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      size += chunk.length
      if (size <= limit) return
      if (kind === 'page') finish(Buffer.concat(chunks).subarray(0, limit))
      else finish(new FetchError('too_large'))
    })
    response.on('end', () => finish(Buffer.concat(chunks)))
    response.on('error', () => finish(new FetchError(signal.aborted ? 'timeout' : 'network')))
    // A connection that closes before the end leaves half an answer.
    response.on('close', () => finish(new FetchError(signal.aborted ? 'timeout' : 'network')))
  })
}

/**
 * Fetches one address, following its redirects by hand so each one gets every check again.
 * With `post`, that text is sent as JSON, and a redirect is refused: what was meant for one
 * address isn't handed to another.
 */
export async function guardedGet(address: string, base: URL | undefined, kind: Kind, fetching: Fetching, post?: string): Promise<{ url: URL, data: Buffer }> {
  const { options } = fetching
  let url = checked(address, base, options.policy)
  for (let redirects = 0; ; redirects++) {
    const response = await send(url, await pinned(url, fetching), kind, fetching, post)
    const status = response.statusCode ?? 0
    if (REDIRECTS.has(status)) {
      response.destroy()
      const location = response.headers.location
      if (!location || post !== undefined) throw new FetchError('status')
      if (redirects >= options.maxRedirects) throw new FetchError('redirects')
      url = checked(location, url, options.policy)
      continue
    }
    if (status !== 200) {
      response.destroy()
      throw new FetchError('status')
    }
    if (kind !== 'image') {
      const type = (response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
      const packed = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase() !== 'identity'
      if (!(kind === 'page' ? PAGE_TYPES : JSON_TYPES).has(type) || packed) {
        response.destroy()
        throw new FetchError('type')
      }
    }
    const limit = kind === 'image' ? options.maxImageBytes : options.maxPageBytes
    return { url, data: await body(response, limit, kind, fetching) }
  }
}

/**
 * Runs `work` with one clock for everything it fetches: when `timeoutMs` is over, whatever is
 * still out is ended. What goes wrong on the way without a reason of its own counts as the
 * network's doing.
 */
export async function withinTime<T>(options: Partial<FetchOptions>, work: (fetching: Fetching) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const fetching: Fetching = { options: { ...DEFAULTS, ...options }, signal: controller.signal }
  const timer = setTimeout(() => controller.abort(), fetching.options.timeoutMs)
  try {
    return await work(fetching)
  }
  catch (error) {
    throw error instanceof FetchError ? error : new FetchError(controller.signal.aborted ? 'timeout' : 'network')
  }
  finally {
    clearTimeout(timer)
    // Ends whatever is still open.
    controller.abort()
  }
}

/** `fetching` with a clock of its own inside the shared one, so one slow shop doesn't use up the time of the others. */
export function sooner(fetching: Fetching, ms: number): Fetching {
  return { options: fetching.options, signal: AbortSignal.any([fetching.signal, AbortSignal.timeout(ms)]) }
}

/** The picture at `address`: fetched, and its first bytes must say JPEG, PNG or WebP. */
export async function pictureAt(address: string, fetching: Fetching): Promise<Cover> {
  const image = await guardedGet(address, undefined, 'image', fetching)
  const ext = sniffImage(image.data)
  if (!ext) throw new FetchError('not_image')
  return { data: image.data, ext }
}

/** The picture at `address`, or null when there is none to be had, whatever the reason. Never throws. */
export async function fetchPicture(address: string, options: Partial<FetchOptions> = {}): Promise<Cover | null> {
  return withinTime(options, fetching => pictureAt(address, fetching)).catch(() => null)
}
