import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getListView } from '../server/domain/list-view'
import { addWish, setWishImage, updateWish } from '../server/domain/wishes'
import { COVER_FETCHES, coverAddress, fetchCover, isPublicAddress, loadCover, refreshCover, strictPolicy, type FetchPolicy } from '../server/utils/link-cover'
import { clearHits } from '../server/utils/rate-limit'
import { wishInput, wishPatchInput } from '../shared/schemas/input'
import { addList, addUser, makeDb, wishIn } from './helpers'

describe('whether the server may connect to an address', () => {
  it('refuses every IPv4 range that isn\'t the public internet', () => {
    const refused = [
      // 0.0.0.0/8: this network
      '0.0.0.0', '0.1.2.3', '0.255.255.255',
      // 10/8, 172.16/12, 192.168/16: private
      '10.0.0.0', '10.0.0.1', '10.255.255.255',
      '172.16.0.0', '172.16.0.1', '172.20.10.5', '172.31.255.255',
      '192.168.0.0', '192.168.1.1', '192.168.255.255',
      // 100.64/10: shared by a provider's customers
      '100.64.0.0', '100.64.0.1', '100.100.100.100', '100.127.255.255',
      // 127/8: this machine
      '127.0.0.0', '127.0.0.1', '127.1.2.3', '127.255.255.255',
      // 169.254/16: link-local, where cloud metadata lives
      '169.254.0.0', '169.254.169.254', '169.254.255.255',
      // 192.0.0/24: protocol assignments
      '192.0.0.0', '192.0.0.8', '192.0.0.255',
      // 192.0.2/24, 198.51.100/24, 203.0.113/24: documentation
      '192.0.2.0', '192.0.2.1', '192.0.2.255',
      '198.51.100.0', '198.51.100.7', '198.51.100.255',
      '203.0.113.0', '203.0.113.9', '203.0.113.255',
      // 198.18/15: benchmarks
      '198.18.0.0', '198.18.0.1', '198.19.255.255',
      // 224/4: multicast
      '224.0.0.0', '224.0.0.1', '233.252.0.1', '239.255.255.255',
      // 240/4: reserved, and broadcast
      '240.0.0.0', '240.0.0.1', '254.255.255.255', '255.255.255.255',
    ]
    for (const ip of refused) expect(isPublicAddress(ip), ip).toBe(false)
  })

  it('allows the addresses just outside those ranges', () => {
    const allowed = [
      '1.0.0.0', '1.1.1.1', '8.8.8.8', '9.255.255.255', '11.0.0.0',
      '100.63.255.255', '100.128.0.0',
      '126.255.255.255', '128.0.0.0',
      '169.253.255.255', '169.255.0.0',
      '172.15.255.255', '172.32.0.0',
      '191.255.255.255', '192.0.1.0', '192.0.3.0',
      '192.167.255.255', '192.169.0.0',
      '198.17.255.255', '198.20.0.0',
      '198.51.99.255', '198.51.101.0',
      '203.0.112.255', '203.0.114.0',
      '223.255.255.255',
      '93.184.216.34',
    ]
    for (const ip of allowed) expect(isPublicAddress(ip), ip).toBe(true)
  })

  it('refuses every IPv6 range that isn\'t the public internet', () => {
    const refused = [
      // unspecified and loopback, in every way of writing them
      '::', '0:0:0:0:0:0:0:0', '::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001',
      // 64:ff9b::/96: an IPv4 address behind a translator
      '64:ff9b::', '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::808:808',
      // fc00::/7: private
      'fc00::', 'fc00::1', 'fd12:3456:789a::1', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      // fe80::/10: link-local
      'fe80::', 'fe80::1', 'febf:ffff::1',
      // ff00::/8: multicast
      'ff00::', 'ff02::1', 'ff0e::1', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      // 2001:db8::/32: documentation
      '2001:db8::', '2001:db8::1', '2001:DB8:ffff:ffff:ffff:ffff:ffff:ffff',
      // Less well known, and not the public internet either: old site-local addresses, an IPv4
      // address written the old "compatible" way, discard-only, Teredo, and 6to4 to a private address.
      'fec0::1', '::7f00:1', '::127.0.0.1', '100::1', '2001::1', '2002:7f00:1::1', '2002:c0a8:101::1',
    ]
    for (const ip of refused) expect(isPublicAddress(ip), ip).toBe(false)
  })

  it('judges an IPv4 address inside an IPv6 one by the IPv4 address', () => {
    const refused = [
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:192.168.1.1', '::ffff:c0a8:101',
      '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:0.0.0.0', '::ffff:0:0', '::ffff:100.64.0.1', '::ffff:255.255.255.255',
      '0:0:0:0:0:ffff:7f00:1', '::FFFF:127.0.0.1',
    ]
    for (const ip of refused) expect(isPublicAddress(ip), ip).toBe(false)
    for (const ip of ['::ffff:8.8.8.8', '::ffff:808:808', '::ffff:93.184.216.34', '2002:808:808::1']) expect(isPublicAddress(ip), ip).toBe(true)
  })

  it('allows public IPv6 addresses', () => {
    for (const ip of ['2606:4700:4700::1111', '2a00:1450:4007:80e::200e', '2001:4860:4860::8888', '2001:db7::1', '2001:db9::1', '2620:fe::fe']) {
      expect(isPublicAddress(ip), ip).toBe(true)
    }
  })

  it('refuses whatever isn\'t an address written the usual way', () => {
    const odd = [
      '', ' ', 'localhost', 'example.com', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-4', '1.2.3.4 ', ' 1.2.3.4',
      // Other ways to write 127.0.0.1 and 8.8.8.8. `new URL` rewrites them to dotted decimals before
      // they get here; one that arrives anyway is refused rather than guessed at.
      '2130706433', '0x7f000001', '0x7f.0.0.1', '0177.0.0.1', '127.1', '010.0.0.1', '08.8.8.8', '8.8.8.08',
      '[::1]', '::1%lo0', 'fe80::1%eth0', '2606:4700:4700::1111%eth0', ':::1', '1::2::3', '12345::1', 'g::1', '::ffff:1.2.3', '::ffff:256.0.0.1',
      '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '8.8.8.8:80',
    ]
    for (const ip of odd) expect(isPublicAddress(ip), JSON.stringify(ip)).toBe(false)
  })

  it('sees through the odd ways to write an IPv4 address once `new URL` has normalised them', () => {
    const hostOf = (address: string) => new URL(address).hostname.replace(/^\[|\]$/g, '')
    for (const address of [
      'http://2130706433/', 'http://0x7f000001/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://127.0.1/',
      'http://0/', 'http://0x0a.0.0.1/', 'http://012.0.0.1/', 'http://3232235777/', 'http://0xc0a80101/', 'http://0xa9fea9fe/',
      'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[0:0:0:0:0:0:0:1]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    ]) {
      expect(isPublicAddress(hostOf(address)), address).toBe(false)
    }
    for (const address of ['http://134744072/', 'http://0x08080808/', 'http://010.8.8.8/', 'http://[2606:4700:4700::1111]/']) {
      expect(isPublicAddress(hostOf(address)), address).toBe(true)
    }
  })
})

describe('the cover a page names', () => {
  const base = 'https://shop.example/products/lamp?id=3'
  const page = (head: string) => `<!doctype html><html><head><title>Lamp</title>${head}</head><body><p>Lamp</p></body></html>`

  it('is the page\'s og:image', () => {
    expect(coverAddress(page('<meta property="og:image" content="https://cdn.example/lamp.jpg">'), base)).toBe('https://cdn.example/lamp.jpg')
  })

  it('is found whatever the quotes, the order of the attributes and the case', () => {
    const variants = [
      '<meta property="og:image" content="https://cdn.example/lamp.jpg">',
      '<meta property=\'og:image\' content=\'https://cdn.example/lamp.jpg\'>',
      '<meta property=og:image content=https://cdn.example/lamp.jpg>',
      '<meta content="https://cdn.example/lamp.jpg" property="og:image">',
      '<meta content=https://cdn.example/lamp.jpg property=og:image />',
      '<META PROPERTY="OG:IMAGE" CONTENT="https://cdn.example/lamp.jpg"/>',
      '<meta\n  data-rh="true"\n  property = "og:image"\n  content = "https://cdn.example/lamp.jpg"\n>',
      '<meta name="og:image" content="https://cdn.example/lamp.jpg">',
      '<meta property=" og:image " content="  https://cdn.example/lamp.jpg  ">',
      '<meta itemprop="image" property="og:image" id="a>b" content="https://cdn.example/lamp.jpg">',
    ]
    for (const tag of variants) expect(coverAddress(page(tag), base), tag).toBe('https://cdn.example/lamp.jpg')
  })

  it('also reads og:image:secure_url, twitter:image and a link rel="image_src"', () => {
    const lamp = 'https://cdn.example/lamp.jpg'
    for (const tag of [
      `<meta property="og:image:secure_url" content="${lamp}">`,
      `<meta property="og:image:url" content="${lamp}">`,
      `<meta name="twitter:image" content="${lamp}">`,
      `<meta property="twitter:image" content="${lamp}">`,
      `<meta name="twitter:image:src" content="${lamp}">`,
      `<link rel="image_src" href="${lamp}">`,
      `<link href='${lamp}' rel='image_src'>`,
      `<LINK REL=image_src HREF=${lamp}>`,
    ]) {
      expect(coverAddress(page(tag), base), tag).toBe(lamp)
    }
  })

  it('prefers og:image, then og:image:secure_url, then twitter:image, then image_src, wherever they stand', () => {
    const tags = [
      '<link rel="image_src" href="https://cdn.example/src.jpg">',
      '<meta name="twitter:image" content="https://cdn.example/twitter.jpg">',
      '<meta property="og:image:secure_url" content="https://cdn.example/secure.jpg">',
      '<meta property="og:image" content="https://cdn.example/og.jpg">',
    ]
    expect(coverAddress(page(tags.join('')), base)).toBe('https://cdn.example/og.jpg')
    expect(coverAddress(page(tags.slice(0, 3).join('')), base)).toBe('https://cdn.example/secure.jpg')
    expect(coverAddress(page(tags.slice(0, 2).join('')), base)).toBe('https://cdn.example/twitter.jpg')
    expect(coverAddress(page(tags.slice(0, 1).join('')), base)).toBe('https://cdn.example/src.jpg')
  })

  it('takes the first of several og:images', () => {
    const head = '<meta property="og:image" content="https://cdn.example/1.jpg"><meta property="og:image" content="https://cdn.example/2.jpg">'
    expect(coverAddress(page(head), base)).toBe('https://cdn.example/1.jpg')
  })

  it('resolves a relative or protocol-relative address against the page\'s own', () => {
    const og = (content: string) => page(`<meta property="og:image" content="${content}">`)
    expect(coverAddress(og('/img/lamp.jpg'), base)).toBe('https://shop.example/img/lamp.jpg')
    expect(coverAddress(og('img/lamp.jpg'), base)).toBe('https://shop.example/products/img/lamp.jpg')
    expect(coverAddress(og('../lamp.jpg?w=600'), base)).toBe('https://shop.example/lamp.jpg?w=600')
    expect(coverAddress(og('//cdn.example/lamp.jpg'), base)).toBe('https://cdn.example/lamp.jpg')
    expect(coverAddress(og('//cdn.example/lamp.jpg'), 'http://shop.example/')).toBe('http://cdn.example/lamp.jpg')
    expect(coverAddress(og('HTTP://CDN.example/Lamp.JPG'), base)).toBe('http://cdn.example/Lamp.JPG')
  })

  it('decodes HTML entities in the address', () => {
    const og = (content: string) => page(`<meta property="og:image" content="${content}">`)
    expect(coverAddress(og('https://cdn.example/lamp.jpg?w=600&amp;h=400'), base)).toBe('https://cdn.example/lamp.jpg?w=600&h=400')
    expect(coverAddress(og('https://cdn.example/lamp.jpg?w=600&#38;h=400&#x26;q=80'), base)).toBe('https://cdn.example/lamp.jpg?w=600&h=400&q=80')
    expect(coverAddress(og('https:&#x2F;&#x2F;cdn.example&#47;lamp.jpg'), base)).toBe('https://cdn.example/lamp.jpg')
    expect(coverAddress(og('https://cdn.example/a&quot;b&apos;c&lt;d&gt;.jpg'), base)).toBe('https://cdn.example/a%22b\'c%3Cd%3E.jpg')
    // An entity that names no character is left as it was written.
    expect(coverAddress(og('https://cdn.example/lamp.jpg?a=1&copy=2&unknown;'), base)).toBe('https://cdn.example/lamp.jpg?a=1&copy=2&unknown;')
    // An entity in the property's name counts too.
    expect(coverAddress(page('<meta property="og&#58;image" content="https://cdn.example/lamp.jpg">'), base)).toBe('https://cdn.example/lamp.jpg')
  })

  it('refuses an address that isn\'t http or https', () => {
    const og = (content: string) => page(`<meta property="og:image" content="${content}">`)
    for (const bad of [
      'data:image/png;base64,iVBORw0KGgo=', 'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java&#115;cript:alert(1)',
      'file:///etc/passwd', 'ftp://cdn.example/lamp.jpg', 'blob:https://shop.example/1', 'about:blank', 'vbscript:x', '', '   ', 'http://', 'https://[bad',
    ]) {
      expect(coverAddress(og(bad), base), bad).toBeNull()
    }
  })

  it('goes on to the next kind when the first names nothing usable', () => {
    const head = '<meta property="og:image" content="data:image/png;base64,iVBORw0KGgo="><meta property="og:image" content=""><meta name="twitter:image" content="/lamp.jpg">'
    expect(coverAddress(page(head), base)).toBe('https://shop.example/lamp.jpg')
  })

  it('is nothing for a page without such a tag', () => {
    expect(coverAddress(page(''), base)).toBeNull()
    expect(coverAddress('', base)).toBeNull()
    expect(coverAddress('just text, no tags', base)).toBeNull()
    expect(coverAddress(page('<meta name="description" content="https://cdn.example/lamp.jpg"><meta property="og:title" content="Lamp">'), base)).toBeNull()
    expect(coverAddress(page('<meta property="og:image">'), base)).toBeNull()
    expect(coverAddress(page('<meta content="https://cdn.example/lamp.jpg">'), base)).toBeNull()
    expect(coverAddress(page('<link rel="stylesheet" href="/lamp.css"><link rel="icon" href="/lamp.ico">'), base)).toBeNull()
    expect(coverAddress(page('<metadata property="og:image" content="https://cdn.example/lamp.jpg">'), base)).toBeNull()
    expect(coverAddress(page('<meta property="og:image:width" content="600"><meta property="og:image:alt" content="https://cdn.example/lamp.jpg">'), base)).toBeNull()
  })

  it('ignores a tag inside a comment, a script or a style', () => {
    const tag = '<meta property="og:image" content="https://cdn.example/lamp.jpg">'
    expect(coverAddress(page(`<!-- ${tag} -->`), base)).toBeNull()
    expect(coverAddress(page(`<script>document.write('${tag}')</script>`), base)).toBeNull()
    expect(coverAddress(page(`<SCRIPT type="text/template">${tag}</SCRIPT>`), base)).toBeNull()
    expect(coverAddress(page(`<style>/* ${tag} */</style>`), base)).toBeNull()
    expect(coverAddress(page(`<!-- a --><script>x</script>${tag}<!-- b -->`), base)).toBe('https://cdn.example/lamp.jpg')
  })

  it('reads what is outside a comment, script or style that never closes, as a browser does', () => {
    const tag = '<meta property="og:image" content="https://cdn.example/lamp.jpg">'
    for (const opener of ['<!--', '<script>', '<style>']) {
      expect(coverAddress(page(`${tag}${opener} the rest`), base), opener).toBe('https://cdn.example/lamp.jpg')
      expect(coverAddress(page(`${opener}${tag}`), base), opener).toBeNull()
    }
  })

  // The page is read in one go, on the one thread that also answers everyone else.
  it('reads a page made of openers that never close without slowing down', () => {
    for (const opener of ['<!--', '<script', '<style ', '</script ', '<meta ']) {
      const hostile = opener.repeat(Math.floor(512 * 1024 / opener.length))
      const start = performance.now()
      expect(coverAddress(hostile, base), opener).toBeNull()
      expect(performance.now() - start, opener).toBeLessThan(250)
    }
  })

  it('copes with a page that was cut off or is broken', () => {
    expect(coverAddress('<html><head><meta property="og:image" content="https://cdn.example/lamp.jpg"><meta property="og:ti', base)).toBe('https://cdn.example/lamp.jpg')
    expect(coverAddress('<meta property="og:image" content="https://cdn.example/lamp.jpg', base)).toBeNull()
    expect(coverAddress('<meta property="og:image" content=', base)).toBeNull()
    expect(coverAddress('<meta', base)).toBeNull()
    expect(coverAddress('<meta property="og:image" content="/lamp.jpg">', 'not an address')).toBeNull()
    expect(coverAddress(`${'<meta '.repeat(20000)}>`, base)).toBeNull()
  })
})

// A shop on this machine. Each test sets what it answers.
type Handler = (req: IncomingMessage, res: ServerResponse) => void
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 7)])
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(64, 7)])

let server: Server
let port: number
let routes: Record<string, Handler> = {}
let seen: { url: string, headers: IncomingMessage['headers'] }[] = []
let connections = 0

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ url: req.url!, headers: req.headers })
    const handler = routes[req.url!.split('?')[0]!]
    if (handler) handler(req, res)
    else res.writeHead(404).end('not here')
  })
  server.on('connection', () => connections++)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

beforeEach(() => {
  routes = {}
  seen = []
  connections = 0
})

/** Every name is this machine, and only this machine may be reached: what a test needs and the site never allows. */
const local: FetchPolicy = {
  resolve: async () => ['127.0.0.1'],
  allowsAddress: ip => ip === '127.0.0.1',
  allowsPort: () => true,
}
const shop = (path = '/') => `http://shop.test:${port}${path}`
const html = (body: string): Handler => (_req, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body)
const og = (image: string) => html(`<html><head><meta property="og:image" content="${image}"></head><body>Lamp</body></html>`)
const bytes = (data: Buffer, type = 'image/png'): Handler => (_req, res) => res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length }).end(data)
const redirect = (to: string, status = 302): Handler => (_req, res) => res.writeHead(status, { Location: to }).end()
const reasonOf = (attempt: Promise<unknown>) => attempt.then(() => 'no failure', error => (error as { reason?: string }).reason ?? String(error))

describe('fetching the cover of a link', () => {
  it('reads the page, finds its og:image and downloads it', async () => {
    routes['/lamp'] = og('/img/lamp.png')
    routes['/img/lamp.png'] = bytes(PNG)
    const cover = await loadCover(shop('/lamp'), { policy: local })
    expect(cover.ext).toBe('png')
    expect(cover.data.equals(PNG)).toBe(true)
    expect(seen.map(request => request.url)).toEqual(['/lamp', '/img/lamp.png'])
  })

  it('takes the type from the first bytes, whatever the server calls it', async () => {
    routes['/lamp'] = og('/lamp.bin')
    routes['/lamp.bin'] = bytes(JPEG, 'application/octet-stream')
    expect((await loadCover(shop('/lamp'), { policy: local })).ext).toBe('jpg')
  })

  it('says who is asking, and sends no cookie, login or address of a visitor', async () => {
    routes['/lamp'] = og('/lamp.png')
    routes['/lamp.png'] = bytes(PNG)
    await loadCover(shop('/lamp'), { policy: local })
    expect(seen).toHaveLength(2)
    for (const { headers } of seen) {
      expect(headers['user-agent']).toBe('Pakske link preview')
      // The name the owner typed, though the connection went to the address that was checked.
      expect(headers.host).toBe(`shop.test:${port}`)
      expect(headers['accept-encoding']).toBe('identity')
      expect(Object.keys(headers).sort()).toEqual(['accept', 'accept-encoding', 'connection', 'host', 'user-agent'])
    }
    expect(seen[0]!.headers.accept).toContain('text/html')
    expect(seen[1]!.headers.accept).toContain('image/')
  })

  it('connects to the address it checked, and never asks for the name again', async () => {
    routes['/lamp'] = og('/lamp.png')
    routes['/lamp.png'] = bytes(PNG)
    let asked = 0
    // `shop.test` exists nowhere: only the address the resolver gave can have been used.
    const policy: FetchPolicy = { ...local, resolve: async (host) => {
      expect(host).toBe('shop.test')
      asked++
      return ['127.0.0.1']
    } }
    await loadCover(shop('/lamp'), { policy })
    // Once per request: the page and the picture.
    expect(asked).toBe(2)
    expect(connections).toBe(2)
  })

  it('follows redirects, to the page and to the picture', async () => {
    routes['/a'] = redirect('/b', 301)
    routes['/b'] = redirect(shop('/c'), 302)
    routes['/c'] = redirect('lamp', 307)
    routes['/lamp'] = og('img.png')
    routes['/img.png'] = redirect('/cdn/lamp.png', 308)
    routes['/cdn/lamp.png'] = bytes(PNG)
    const cover = await loadCover(shop('/a'), { policy: local })
    expect(cover.ext).toBe('png')
    expect(seen.map(request => request.url)).toEqual(['/a', '/b', '/c', '/lamp', '/img.png', '/cdn/lamp.png'])
  })

  it('resolves the cover against the address the redirects ended at', async () => {
    routes['/go'] = redirect('/nl/products/lamp')
    routes['/nl/products/lamp'] = og('lamp.png')
    routes['/nl/products/lamp.png'] = bytes(PNG)
    expect((await loadCover(shop('/go'), { policy: local })).ext).toBe('png')
  })

  it('gives up after three redirects', async () => {
    routes['/1'] = redirect('/2')
    routes['/2'] = redirect('/3')
    routes['/3'] = redirect('/4')
    routes['/4'] = redirect('/lamp')
    routes['/lamp'] = og('/lamp.png')
    routes['/lamp.png'] = bytes(PNG)
    expect(await reasonOf(loadCover(shop('/1'), { policy: local }))).toBe('redirects')
    expect(seen.map(request => request.url)).toEqual(['/1', '/2', '/3', '/4'])
    // The picture's redirects are counted the same way.
    routes['/lamp'] = og('/1')
    routes['/4'] = redirect('/lamp.png')
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: local }))).toBe('redirects')
    // A loop ends the same way.
    routes['/loop'] = redirect('/loop')
    expect(await reasonOf(loadCover(shop('/loop'), { policy: local }))).toBe('redirects')
  })

  it('checks every redirect like the first address', async () => {
    const inside: FetchPolicy = { ...local, resolve: async host => host === 'shop.test' ? ['127.0.0.1'] : ['192.168.1.1'] }
    for (const [to, reason] of [
      [`http://router.test:${port}/admin`, 'private'],
      ['http://192.168.1.1/admin', 'private'],
      ['http://[fd00::1]/admin', 'private'],
      ['http://169.254.169.254/latest/meta-data/', 'private'],
      ['ftp://shop.test/lamp', 'address'],
      ['file:///etc/passwd', 'address'],
      [`http://art:secret@shop.test:${port}/lamp`, 'address'],
      ['http://[bad/', 'address'],
    ] as const) {
      seen = []
      routes['/go'] = redirect(to)
      expect(await reasonOf(loadCover(shop('/go'), { policy: inside })), to).toBe(reason)
      expect(seen.map(request => request.url), to).toEqual(['/go'])
    }
    // And the picture's address, and its redirects.
    seen = []
    routes['/lamp'] = og(`http://router.test:${port}/lamp.png`)
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: inside }))).toBe('private')
    routes['/lamp'] = og('/img')
    routes['/img'] = redirect(`http://router.test:${port}/lamp.png`)
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: inside }))).toBe('private')
    expect(seen.map(request => request.url)).toEqual(['/lamp', '/lamp', '/img'])
  })

  it('refuses a redirect without an address, and an answer that isn\'t "here it is"', async () => {
    routes['/go'] = (_req, res) => res.writeHead(302).end()
    expect(await reasonOf(loadCover(shop('/go'), { policy: local }))).toBe('status')
    expect(await reasonOf(loadCover(shop('/nothing'), { policy: local }))).toBe('status')
    routes['/down'] = (_req, res) => res.writeHead(503, { 'Content-Type': 'text/html' }).end('<meta property="og:image" content="/lamp.png">')
    expect(await reasonOf(loadCover(shop('/down'), { policy: local }))).toBe('status')
    routes['/lamp'] = og('/gone.png')
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: local }))).toBe('status')
  })

  it('reads only pages: no other type, and nothing packed', async () => {
    const tag = '<meta property="og:image" content="/lamp.png">'
    routes['/lamp.png'] = bytes(PNG)
    routes['/json'] = (_req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ html: tag }))
    routes['/text'] = (_req, res) => res.writeHead(200, { 'Content-Type': 'text/plain' }).end(tag)
    routes['/none'] = (_req, res) => res.writeHead(200).end(tag)
    routes['/picture'] = bytes(PNG)
    routes['/packed'] = (_req, res) => res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }).end(tag)
    for (const path of ['/json', '/text', '/none', '/picture', '/packed']) {
      expect(await reasonOf(loadCover(shop(path), { policy: local })), path).toBe('type')
    }
    routes['/xhtml'] = (_req, res) => res.writeHead(200, { 'Content-Type': 'Application/XHTML+XML; charset=utf-8' }).end(tag)
    expect((await loadCover(shop('/xhtml'), { policy: local })).ext).toBe('png')
  })

  it('finds nothing on a page without a cover', async () => {
    routes['/lamp'] = html('<html><head><title>Lamp</title></head></html>')
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: local }))).toBe('no_cover')
    routes['/lamp'] = og('data:image/png;base64,iVBORw0KGgo=')
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: local }))).toBe('no_cover')
    expect(seen).toHaveLength(2)
  })

  it('reads the start of a page that is too big, and stops there', async () => {
    const tag = '<meta property="og:image" content="/lamp.png">'
    const filler = `<p>${'x'.repeat(1024)}</p>`
    routes['/lamp.png'] = bytes(PNG)
    // The head fits in what is read; the megabytes after it are never asked for.
    let sent = 0
    routes['/long'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.write(`<html><head>${tag}</head><body>`)
      const more = () => {
        if (res.destroyed || sent > 4000) return res.end()
        sent++
        res.write(filler, () => setImmediate(more))
      }
      more()
    }
    expect((await loadCover(shop('/long'), { policy: local, maxPageBytes: 8 * 1024 })).ext).toBe('png')
    expect(sent).toBeLessThan(4000)

    // A cover named after the limit isn't seen.
    routes['/late'] = html(`<html><head>${filler.repeat(9)}${tag}</head></html>`)
    expect(await reasonOf(loadCover(shop('/late'), { policy: local, maxPageBytes: 8 * 1024 }))).toBe('no_cover')
    expect((await loadCover(shop('/late'), { policy: local, maxPageBytes: 16 * 1024 })).ext).toBe('png')
  })

  it('refuses a picture that says it is too big, before reading it', async () => {
    routes['/lamp'] = og('/big.png')
    let written = false
    routes['/big.png'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 3 * 1024 * 1024 + 1 })
      written = res.write(PNG)
    }
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: local }))).toBe('too_large')
    expect(written).toBe(true)
  })

  it('refuses a picture that turns out too big while it comes in', async () => {
    routes['/lamp'] = og('/big.png')
    let chunks = 0
    // No length up front: the size only shows as the bytes arrive.
    routes['/big.png'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.write(PNG)
      const more = () => {
        if (res.destroyed || chunks > 4000) return res.end()
        chunks++
        res.write(Buffer.alloc(1024, 7), () => setImmediate(more))
      }
      more()
    }
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: local, maxImageBytes: 16 * 1024 }))).toBe('too_large')
    expect(chunks).toBeLessThan(4000)
    // The same when it all comes at once.
    routes['/big.png'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' })
      res.end(Buffer.concat([PNG, Buffer.alloc(32 * 1024, 7)]))
    }
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: local, maxImageBytes: 16 * 1024 }))).toBe('too_large')
    // Exactly the limit is fine.
    routes['/big.png'] = bytes(Buffer.concat([PNG, Buffer.alloc(16 * 1024 - PNG.length, 7)]))
    expect((await loadCover(shop('/lamp'), { policy: local, maxImageBytes: 16 * 1024 })).data).toHaveLength(16 * 1024)
  })

  it('allows a picture of 3 MB and a page of 512 KB by default', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024 - PNG.length, 7)])
    const tag = '<meta property="og:image" content="/big.png">'
    routes['/lamp'] = html(`<html><head>${' '.repeat(512 * 1024 - tag.length - 12)}${tag}`)
    routes['/big.png'] = bytes(big)
    expect((await loadCover(shop('/lamp'), { policy: local })).data).toHaveLength(3 * 1024 * 1024)
    routes['/lamp'] = html(`<html><head>${' '.repeat(512 * 1024)}${tag}`)
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: local }))).toBe('no_cover')
    routes['/lamp'] = og('/big.png')
    routes['/big.png'] = bytes(Buffer.concat([big, Buffer.from([7])]))
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: local }))).toBe('too_large')
  })

  it('refuses what isn\'t a JPEG, PNG or WebP', async () => {
    routes['/lamp'] = og('/cover')
    for (const [body, type] of [
      [Buffer.from('<html><body>Log in to see this picture</body></html>'), 'text/html'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml'],
      [Buffer.from('GIF89a' + 'x'.repeat(64)), 'image/gif'],
      [Buffer.from('not a picture at all'), 'image/png'],
      [Buffer.alloc(0), 'image/png'],
    ] as const) {
      routes['/cover'] = bytes(body, type)
      expect(await reasonOf(loadCover(shop('/lamp'), { policy: local })), type).toBe('not_image')
    }
  })

  it('stops waiting for a slow shop', async () => {
    const hanging: ServerResponse[] = []
    routes['/silent'] = (_req, res) => hanging.push(res)
    routes['/drip'] = (_req, res) => {
      hanging.push(res)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      const timer = setInterval(() => res.destroyed ? clearInterval(timer) : res.write(' '), 20)
    }
    routes['/lamp'] = og('/slow.png')
    routes['/slow.png'] = (_req, res) => {
      hanging.push(res)
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length })
      res.write(PNG.subarray(0, 4))
    }
    for (const path of ['/silent', '/drip', '/lamp']) {
      const started = Date.now()
      expect(await reasonOf(loadCover(shop(path), { policy: local, timeoutMs: 300 })), path).toBe('timeout')
      expect(Date.now() - started, path).toBeLessThan(1500)
    }
    // The time is for the page and the picture together, not for each.
    const slowly = (handler: Handler): Handler => (req, res) => setTimeout(() => handler(req, res), 200)
    routes['/lamp'] = slowly(og('/lamp.png'))
    routes['/lamp.png'] = slowly(bytes(PNG))
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: local, timeoutMs: 300 }))).toBe('timeout')
    expect((await loadCover(shop('/lamp'), { policy: local, timeoutMs: 3000 })).ext).toBe('png')
    for (const res of hanging) res.destroy()
  })

  it('stops waiting for a name that doesn\'t resolve in time', async () => {
    const policy: FetchPolicy = { ...local, resolve: () => new Promise(() => {}) }
    expect(await reasonOf(loadCover(shop('/lamp'), { policy, timeoutMs: 100 }))).toBe('timeout')
    expect(connections).toBe(0)
  })

  it('fails quietly when the shop can\'t be reached', async () => {
    const closed = http.createServer()
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve))
    const gone = (closed.address() as AddressInfo).port
    await new Promise(resolve => closed.close(resolve))
    expect(await reasonOf(loadCover(`http://shop.test:${gone}/lamp`, { policy: local }))).toBe('network')
    routes['/hangup'] = (req) => { req.socket.destroy() }
    expect(await reasonOf(loadCover(shop('/hangup'), { policy: local }))).toBe('network')
    routes['/half'] = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': 5000 })
      res.write('<html>', () => req.socket.destroy())
    }
    expect(await reasonOf(loadCover(shop('/half'), { policy: local }))).toBe('network')
    const unknown: FetchPolicy = { ...local, resolve: async () => { throw new Error('ENOTFOUND') } }
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: unknown }))).toBe('network')
    expect(await reasonOf(loadCover(shop('/lamp'), { policy: { ...local, resolve: async () => [] } }))).toBe('network')
  })

  it('answers with the cover or with nothing, never with what went wrong', async () => {
    routes['/lamp'] = og('/lamp.png')
    routes['/lamp.png'] = bytes(PNG)
    expect(await fetchCover(shop('/lamp'), { policy: local })).toMatchObject({ ext: 'png' })
    for (const address of [shop('/nothing'), 'not an address', 'http://192.168.1.1/', '', 'javascript:alert(1)']) {
      expect(await fetchCover(address, { policy: local }), address).toBeNull()
    }
  })
})

describe('what the site itself refuses to fetch', () => {
  const requests = () => [vi.spyOn(http, 'request'), vi.spyOn(https, 'request')]
  afterEach(() => vi.restoreAllMocks())

  it('never connects to this machine or the home network', async () => {
    const spies = requests()
    routes['/'] = og('/lamp.png')
    for (const address of [
      `http://127.0.0.1:${port}/`, 'http://127.0.0.1/', 'http://localhost/', 'https://localhost/', 'http://LOCALHOST./',
      'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://0.0.0.0/', 'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://127.1/',
      'http://10.0.0.1/', 'http://192.168.1.1/', 'https://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[64:ff9b::7f00:1]/',
    ]) {
      expect(await fetchCover(address), address).toBeNull()
    }
    expect(await reasonOf(loadCover(`http://127.0.0.1:${port}/`))).toBe('address')
    expect(await reasonOf(loadCover('http://127.0.0.1/'))).toBe('private')
    expect(await reasonOf(loadCover('http://localhost/'))).toBe('private')
    expect(await reasonOf(loadCover('http://[::1]/'))).toBe('private')
    expect(await reasonOf(loadCover('http://2130706433/'))).toBe('private')
    expect(connections).toBe(0)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('judges this machine\'s address the same on a port it would allow', async () => {
    const spies = requests()
    routes['/'] = og('/lamp.png')
    // Every port allowed, so only the address check stands between the fetch and the shop on this machine.
    const anyPort: FetchPolicy = { ...strictPolicy, allowsPort: () => true }
    expect(await reasonOf(loadCover(`http://127.0.0.1:${port}/`, { policy: anyPort }))).toBe('private')
    expect(await reasonOf(loadCover(`http://localhost:${port}/`, { policy: anyPort }))).toBe('private')
    expect(connections).toBe(0)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('refuses a name when any one of its addresses is not public', async () => {
    const spies = requests()
    for (const addresses of [['93.184.216.34', '127.0.0.1'], ['10.0.0.1', '93.184.216.34'], ['2606:4700:4700::1111', '::1'], ['93.184.216.34', 'not an address']]) {
      const policy: FetchPolicy = { ...strictPolicy, resolve: async () => addresses }
      expect(await reasonOf(loadCover('http://shop.example/', { policy })), addresses.join()).toBe('private')
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('takes only http and https, on their own ports, without a login in the address', async () => {
    const spies = requests()
    const everywhere: FetchPolicy = { ...strictPolicy, resolve: async () => ['93.184.216.34'] }
    for (const address of [
      'ftp://shop.example/lamp', 'file:///etc/passwd', 'gopher://shop.example/', 'javascript:alert(1)', 'data:text/html,<meta>', 'shop.example', '//shop.example/', '',
      'http://shop.example:8080/', 'https://shop.example:8443/', 'http://shop.example:443/', 'https://shop.example:80/', 'http://shop.example:22/', 'http://shop.example:3400/',
      'http://art@shop.example/', 'http://art:secret@shop.example/', 'https://:secret@shop.example/',
    ]) {
      expect(await reasonOf(loadCover(address, { policy: everywhere })), address).toBe('address')
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    // The scheme's own port written out is the same address.
    expect(strictPolicy.allowsPort(new URL('http://shop.example:80/').port)).toBe(true)
    expect(strictPolicy.allowsPort(new URL('https://shop.example:443/').port)).toBe(true)
  })
})

describe('putting the cover on a wish', () => {
  const shopLink = 'https://shop.example/lamp'
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'covers-'))
    // What Nitro gives the server's own code; uploads.ts asks it where the pictures go.
    vi.stubGlobal('useRuntimeConfig', () => ({ dataDir }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(dataDir, { recursive: true, force: true })
  })

  function setup() {
    const db = makeDb()
    const art = addUser(db, 'art')
    clearHits(`cover:${art.id}`)
    const token = addList(db, art.id)
    const wish = addWish(db, art.id, token, wishInput.parse({ title: 'Lamp', urls: [shopLink] }))
    const view = () => wishIn(getListView(db, token, art.id), wish.id)!
    return { db, art, token, wish, view }
  }
  const files = () => existsSync(join(dataDir, 'uploads')) ? readdirSync(join(dataDir, 'uploads')) : []
  const found = async () => ({ data: PNG, ext: 'png' as const })

  it('stores the picture and shows it as the cover of the link', async () => {
    const { db, art, token, wish, view } = setup()
    const asked: string[] = []
    const result = await refreshCover(db, art.id, token, wish.id, shopLink, async (address) => {
      asked.push(address)
      return found()
    })
    expect(asked).toEqual([shopLink])
    expect(files()).toHaveLength(1)
    expect(files()[0]).toMatch(/^[a-f0-9]{32}\.png$/)
    expect(readFileSync(join(dataDir, 'uploads', files()[0]!)).equals(PNG)).toBe(true)
    expect(result).toMatchObject({ id: wish.id, image: `/uploads/${files()[0]}`, imageFromLink: true })
    expect(view()).toMatchObject({ image: `/uploads/${files()[0]}`, imageFromLink: true })
  })

  it('leaves the wish without a picture when there is no cover', async () => {
    const { db, art, token, wish, view } = setup()
    expect(await refreshCover(db, art.id, token, wish.id, shopLink, async () => null)).toBeNull()
    expect(await refreshCover(db, art.id, token, wish.id, shopLink, async () => { throw new Error('boom') })).toBeNull()
    expect(files()).toEqual([])
    expect(view()).toMatchObject({ image: null, imageFromLink: false })
  })

  it('removes the old cover\'s file when a new first link brings another', async () => {
    const { db, art, token, wish } = setup()
    await refreshCover(db, art.id, token, wish.id, shopLink, found)
    const [first] = files()
    const other = 'https://other.example/lamp'
    const { coverOf, unused } = updateWish(db, art.id, token, wish.id, wishPatchInput.parse({ urls: [other] }))
    expect({ coverOf, unused }).toEqual({ coverOf: other, unused: [first] })
  })

  it('throws away a cover that comes back after the owner put up a photo, or after the wish went', async () => {
    const { db, art, token, wish, view } = setup()
    expect(await refreshCover(db, art.id, token, wish.id, shopLink, async () => {
      setWishImage(db, art.id, token, wish.id, 'photo.jpg')
      return found()
    })).toBeNull()
    expect(files()).toEqual([])
    expect(view()).toMatchObject({ image: '/uploads/photo.jpg', imageFromLink: false })
    expect(await refreshCover(db, art.id, token, wish.id + 99, shopLink, found)).toBeNull()
    expect(files()).toEqual([])
  })

  it('answers without the cover when the shop takes longer than the request may wait', async () => {
    const { db, art, token, wish, view } = setup()
    const slow = () => new Promise<{ data: Buffer, ext: 'png' }>(resolve => setTimeout(resolve, 150, { data: PNG, ext: 'png' }))
    const started = Date.now()
    expect(await refreshCover(db, art.id, token, wish.id, shopLink, slow, 30)).toBeNull()
    expect(Date.now() - started).toBeLessThan(140)
    expect(view()).toMatchObject({ image: null })
    // The cover that still came in is there the next time the list is opened.
    await vi.waitFor(() => expect(view()).toMatchObject({ imageFromLink: true }))
    expect(files()).toHaveLength(1)
    expect(await refreshCover(db, art.id, token, wish.id, shopLink, () => new Promise(() => {}), 30)).toBeNull()
  })

  it('fetches at most thirty covers per account in ten minutes, and skips the rest', async () => {
    const { db, art, token, wish } = setup()
    const mom = addUser(db, 'mom')
    clearHits(`cover:${mom.id}`)
    let fetched = 0
    const count = async () => {
      fetched++
      return null
    }
    for (let i = 0; i < COVER_FETCHES + 5; i++) await refreshCover(db, art.id, token, wish.id, shopLink, count)
    expect(COVER_FETCHES).toBe(30)
    expect(fetched).toBe(30)
    // Someone else's fetches are counted on their own.
    await refreshCover(db, mom.id, token, wish.id, shopLink, count)
    expect(fetched).toBe(31)
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1)
      await refreshCover(db, art.id, token, wish.id, shopLink, count)
      expect(fetched).toBe(32)
    }
    finally {
      vi.useRealTimers()
    }
  })
})
