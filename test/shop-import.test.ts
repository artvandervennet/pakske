import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getListView } from '../server/domain/list-view'
import { addWishes, setWishImage } from '../server/domain/wishes'
import type { FetchPolicy } from '../server/utils/guarded-fetch'
import { coverImported } from '../server/utils/link-cover'
import { amazonList, bolList, bolMore, bolMoreRequest, linksIn, pageTitle, readImport, shopListOf, type ShopList } from '../server/utils/shop-import'
import { importInput, importReadInput } from '../shared/schemas/input'
import { alreadyListed, IMPORT_MAX } from '../shared/utils/wish-import'
import { addList, addUser, makeDb, wishIn } from './helpers'

// The pages below are made here in the shape the shops' own pages had on 2026-11-21. No real
// list is in them.

const LIST_ID = '2cebd585-7493-4c56-b9b3-5dd07d295a94'

/** A value the way React Router flattens a page's data: every part once in a list, objects and arrays as places in it. */
function flattened(root: unknown): string {
  const values: unknown[] = []
  const place = (value: unknown): number => {
    if (value === null) return -5
    if (value === undefined) return -7
    const at = values.length
    values.push(null)
    if (Array.isArray(value)) values[at] = value.map(place)
    else if (typeof value === 'object') values[at] = Object.fromEntries(Object.entries(value).map(([key, part]) => [`_${place(key)}`, place(part)]))
    else values[at] = value
    return at
  }
  place(root)
  return JSON.stringify(values)
}

type Product = [title: unknown, url: unknown, picture?: unknown]
const bolAssets = (picture: unknown) => picture === undefined
  ? []
  : [{ __typename: 'Asset', altText: 'Boekomslag', renditions: [{ __typename: 'AssetRendition', height: 210, url: picture, width: 130 }] }]

/** A wishlist as bol.com's data has it: `cursor` is set while more items follow. */
const bolWishlist = (products: Product[], page: { total?: number, cursor?: string } = {}) => ({
  __typename: 'Wishlist',
  id: LIST_ID,
  isPublic: true,
  items: {
    __typename: 'WishlistItemConnection',
    edges: products.map(([title, url, picture], at) => ({
      __typename: 'WishlistItemEdge',
      node: { __typename: 'WishlistItem', claim: null, product: { __typename: 'Product', id: `93000000000000${at}`, title, url, assets: bolAssets(picture), wishlists: [] } },
    })),
    pageInfo: { __typename: 'PageInfo', endCursor: page.cursor ?? 'the-end', hasNextPage: page.cursor !== undefined },
  },
  productsTotal: page.total ?? products.length,
  title: 'Fictie',
  toysProfile: null,
})

const bolPage = (wishlist: unknown) => `<!DOCTYPE html><html lang="nl"><head><title>bol | Verlanglijstje</title></head><body><div id="app"></div>
<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(`${flattened({ loaderData: { 'root': { locale: 'nl' }, 'routes/wishlist-public': { wishlist, isAnonymous: true } }, actionData: null, errors: null })}\n`).replaceAll('<', '\\u003c')});</script></body></html>`

const amazonItem = (id: string, asin: string, title: string, picture = `https://m.media-amazon.com/images/I/${asin}._SS135_.jpg`) => `
<li data-id="L1ST" data-itemId="${id}" data-price="13.99" class="a-spacing-none g-item-sortable"><span class="a-list-item">
  <div id="itemImage_${id}" class="a-text-center g-itemImage">
    <a class="a-link-normal" title="${title}" href="/dp/${asin}/?coliid=${id}&amp;colid=L1ST&amp;psc=1&amp;ref_=list_c_wl_lv_vv_lig_dp_it_im">
      <img alt="${title}" src="${picture}" onerror="this.src = 'https://m.media-amazon.com/images/G/01/wishlist/placeholder.png'" height="135" width="135"/>
    </a>
  </div>
  <div id="itemInfo_${id}"><h2 class="a-size-base">
    <a id="itemName_${id}" class="a-link-normal" title="${title}" href="/dp/${asin}/?coliid=${id}&amp;colid=L1ST&amp;psc=1&amp;ref_=list_c_wl_lv_vv_lig_dp_it">${title}</a>
  </h2></div>
</span></li>`

/** A page of an Amazon list. With `next` more follows; without it the page carries the mark that ends the list. */
const amazonPage = (items: string[], next?: string) => `<!doctype html><html><body><ul id="g-items">${items.join('')}
<script type="a-state" data-a-state="{&quot;key&quot;:&quot;scrollState&quot;}">{"showMoreUrl":"/hz/wishlist/slv/items?from=script"}</script>
<li class="a-spacing-none"><form method="get" action="" class="scroll-state">
  <input type="hidden" name="showMoreUrl" value="${next ?? '/hz/wishlist/slv/items?filter=unpurchased&amp;paginationToken=&amp;lid=L1ST'}" class="showMoreUrl"/>
  <input type="hidden" name="lastEvaluatedKey" class="lastEvaluatedKey"/>
</form></li>
${next ? '' : '<li><div id="endOfListMarker" class="a-section"><h5 aria-level="5">Einde van lijst</h5></div></li>'}</ul></body></html>`

describe('the links in what someone pastes', () => {
  it('finds them among other words, in their order, each once', () => {
    const text = `Mijn lijstje: https://www.bol.com/nl/nl/verlanglijstje/${LIST_ID}/ en ook
      https://shop.example/lamp?kleur=rood#maat, (https://shop.example/boek).
      https://shop.example/lamp?kleur=rood#maat nog eens, en HTTP://SHOP.EXAMPLE/Stoel!`
    expect(linksIn(text)).toEqual([
      `https://www.bol.com/nl/nl/verlanglijstje/${LIST_ID}/`,
      'https://shop.example/lamp?kleur=rood#maat',
      'https://shop.example/boek',
      'http://shop.example/Stoel',
    ])
  })

  it('leaves out what isn\'t a web address', () => {
    expect(linksIn('geen link hier, wel www.bol.com en ftp://shop.example/a en javascript:alert(1) en mailto:a@b.example')).toEqual([])
    expect(linksIn('http:// https://[bad/ https://')).toEqual([])
    expect(linksIn(`https://shop.example/${'a'.repeat(2000)}`)).toEqual([])
  })

  it('stops at as many as an import brings', () => {
    const many = Array.from({ length: IMPORT_MAX + 20 }, (_, n) => `https://shop.example/p/${n}`)
    expect(linksIn(many.join('\n'))).toEqual(many.slice(0, IMPORT_MAX))
  })
})

describe('which links are a wishlist at a shop', () => {
  const list = (link: string) => shopListOf(new URL(link))

  it('knows the list someone shares at bol.com, in the Netherlands and in Belgium', () => {
    expect(list(`https://www.bol.com/nl/nl/verlanglijstje/${LIST_ID}/`)).toEqual({ shop: 'bol', id: LIST_ID, page: `https://www.bol.com/nl/nl/verlanglijstje/${LIST_ID}/`, api: 'https://www.bol.com/api/graphql' })
    expect(list(`http://bol.com/be/nl/verlanglijstje/${LIST_ID.toUpperCase()}?utm=x`)).toMatchObject({ shop: 'bol', id: LIST_ID, page: `https://www.bol.com/be/nl/verlanglijstje/${LIST_ID}/` })
  })

  it('reads the page bol.com shows to others when the owner pastes the address of their own view', () => {
    expect(list(`https://www.bol.com/nl/nl/lijstjes/verlanglijstje/${LIST_ID}/`)).toMatchObject({ page: `https://www.bol.com/nl/nl/verlanglijstje/${LIST_ID}/` })
  })

  it('knows a list at Amazon, on the site it is at', () => {
    expect(list('https://www.amazon.nl/hz/wishlist/ls/27TG6Q3RA47E0?ref_=wl_share')).toEqual({ shop: 'amazon', page: 'https://www.amazon.nl/hz/wishlist/ls/27TG6Q3RA47E0' })
    expect(list('https://amazon.com.be/-/en/hz/wishlist/ls/124XKBCGQV6LI/')).toEqual({ shop: 'amazon', page: 'https://www.amazon.com.be/hz/wishlist/ls/124XKBCGQV6LI' })
    expect(list('https://www.amazon.de/hz/wishlist/ls/ABC123DEF')).toMatchObject({ page: 'https://www.amazon.de/hz/wishlist/ls/ABC123DEF' })
  })

  it('takes every other link for the page of a product', () => {
    for (const link of [
      'https://www.bol.com/nl/nl/p/gala-en-zev/9300000300551593/',
      'https://www.bol.com/nl/nl/verlanglijstje/',
      `https://www.bol.com/nl/nl/verlanglijstje/${LIST_ID}/iets`,
      `https://www.bol.com.shop.example/nl/nl/verlanglijstje/${LIST_ID}/`,
      `https://shop.example/nl/nl/verlanglijstje/${LIST_ID}/`,
      'https://www.amazon.nl/dp/0141012692',
      'https://www.amazon.nl/gp/registry/wishlist/27TG6Q3RA47E0',
      'https://amazon.nl.shop.example/hz/wishlist/ls/27TG6Q3RA47E0',
      'https://www.coolblue.be/nl/gedeeld-verlanglijstje/123',
    ]) expect(list(link), link).toBeNull()
  })
})

describe('a wishlist someone shares at bol.com', () => {
  const base = `https://www.bol.com/nl/nl/verlanglijstje/${LIST_ID}/`

  it('reads the data the page carries for its own scripts', () => {
    // Written out by hand as the page has it, so this doesn't lean on the helper above.
    const values = [
      { _1: 2, _3: -5, _4: -5 }, 'loaderData', { _5: 6 }, 'actionData', 'errors', 'routes/wishlist-public', { _7: 8 }, 'wishlist',
      { _9: 10, _19: 20 }, 'items', { _11: 12, _21: 22 }, 'edges', [13], { _14: 15 }, 'node', { _16: 17 }, 'product',
      { _18: 26, _27: 28, _29: 30 }, 'title', 'productsTotal', 19, 'pageInfo', { _23: 24, _25: 31 }, 'endCursor', 'eyJsYXN0SWQiOiI3NSJ9', 'hasNextPage',
      'Gala en Zev', 'url', '/nl/nl/p/gala-en-zev-ebook/9300000300551593/', 'released', ['D', 1779753600000], false,
    ]
    const html = `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(`${JSON.stringify(values)}\n`)});</script>`
    expect(bolList(html, base)).toEqual({
      items: [{ title: 'Gala en Zev', url: 'https://www.bol.com/nl/nl/p/gala-en-zev-ebook/9300000300551593/' }],
      total: 19,
      next: null,
    })
  })

  it('gives every wish its name and the address of its page, in the list\'s order', () => {
    const page = bolPage(bolWishlist([['Gala en Zev', '/nl/nl/p/gala-en-zev-ebook/9300000300551593/'], ['De wonderen', '/nl/nl/p/de-wonderen/9300000234302180/']]))
    expect(bolList(page, base)).toEqual({
      items: [
        { title: 'Gala en Zev', url: 'https://www.bol.com/nl/nl/p/gala-en-zev-ebook/9300000300551593/' },
        { title: 'De wonderen', url: 'https://www.bol.com/nl/nl/p/de-wonderen/9300000234302180/' },
      ],
      total: 2,
      next: null,
    })
  })

  it('takes the picture the list shows, the widest of them, and only from bol.com\'s own pictures', () => {
    const wide = { ...bolWishlist([['Boek', '/nl/nl/p/boek/1/']]) }
    wide.items.edges[0]!.node.product.assets = [{ __typename: 'Asset', altText: '', renditions: [
      { __typename: 'AssetRendition', height: 210, url: 'https://media.s-bol.com/a/b/130x210.jpg', width: 130 },
      { __typename: 'AssetRendition', height: 840, url: 'https://media.s-bol.com/a/b/550x840.jpg', width: 550 },
      { __typename: 'AssetRendition', height: 99, url: 'https://shop.example/900x99.jpg', width: 900 },
    ] }]
    expect(bolList(bolPage(wide), base)!.items).toEqual([{ title: 'Boek', url: 'https://www.bol.com/nl/nl/p/boek/1/', image: 'https://media.s-bol.com/a/b/550x840.jpg' }])
    const page = bolPage(bolWishlist([
      ['Een', '/p/1/', 'https://media.s-bol.com/NqJQ4noGR678/wmzQpRr/130x210.jpg'],
      ['Twee', '/p/2/', 'https://shop.example/130x210.jpg'],
      ['Drie', '/p/3/', 'http://media.s-bol.com/a/b/130x210.jpg'],
      ['Vier', '/p/4/', 'https://media.s-bol.com.shop.example/130x210.jpg'],
      ['Vijf', '/p/5/', 42],
    ]))
    expect(bolList(page, base)!.items.map(item => item.image)).toEqual(['https://media.s-bol.com/NqJQ4noGR678/wmzQpRr/130x210.jpg', undefined, undefined, undefined, undefined])
  })

  it('says what leads to the next items while the list has more', () => {
    const page = bolPage(bolWishlist([['Boek', '/nl/nl/p/boek/1/']], { total: 37, cursor: 'after-24' }))
    expect(bolList(page, base)).toMatchObject({ total: 37, next: 'after-24' })
  })

  it('leaves out what has no name or no web address, and cuts a name that is too long for a title', () => {
    const page = bolPage(bolWishlist([
      ['', '/nl/nl/p/a/1/'], [null, '/nl/nl/p/b/2/'], ['Zonder adres', null], ['Vreemd adres', 'javascript:alert(1)'], [42, '/nl/nl/p/c/3/'],
      ['  Lang\n boek ' + 'x'.repeat(300), '/nl/nl/p/lang/4/'],
    ]))
    const found = bolList(page, base)!
    expect(found.items).toHaveLength(1)
    expect(found.items[0]!.url).toBe('https://www.bol.com/nl/nl/p/lang/4/')
    expect(found.items[0]!.title).toHaveLength(200)
    expect(found.items[0]!.title.startsWith('Lang boek xxx')).toBe(true)
    expect(found.items[0]!.title.endsWith('…')).toBe(true)
  })

  it('is no list when the page carries no such data', () => {
    expect(bolList('<html><body>Niet gevonden</body></html>', base)).toBeNull()
    expect(bolList(bolPage(null), base)).toBeNull()
    expect(bolList(bolPage({ title: 'Fictie' }), base)).toBeNull()
    expect(bolList('<script>window.__reactRouterContext.streamController.enqueue("not json at all");</script>', base)).toBeNull()
    expect(bolList('<script>window.__reactRouterContext.streamController.enqueue("{\\"a\\":1}\\n");</script>', base)).toBeNull()
    // Places that lead nowhere, or round in a circle.
    expect(bolList(`<script>x.streamController.enqueue(${JSON.stringify('[{"_1":0,"_99":5,"_2":-1},"loaderData",[0,2,2]]\n')});</script>`, base)).toBeNull()
  })

  it('takes nothing from a key that would reach an object\'s own workings', () => {
    const values = [{ _1: 2 }, '__proto__', { _3: 4 }, 'polluted', 'yes']
    bolList(`<script>x.streamController.enqueue(${JSON.stringify(`${JSON.stringify(values)}\n`)});</script>`, base)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('asks the API for the items after a cursor, by the query\'s id', () => {
    expect(JSON.parse(bolMoreRequest(LIST_ID, 'after-24'))).toEqual({
      documentId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      variables: { wishlistId: LIST_ID, numberOfProducts: 24, cursor: 'after-24' },
    })
  })

  it('finds the list in the API\'s answer, whatever the answer calls it', () => {
    const wishlist = bolWishlist([['Boek', '/nl/nl/p/boek/1/']], { total: 37, cursor: 'after-48' })
    const expected = { items: [{ title: 'Boek', url: 'https://www.bol.com/nl/nl/p/boek/1/' }], total: 37, next: 'after-48' }
    expect(bolMore(JSON.stringify({ data: { wishlist } }), base)).toEqual(expected)
    expect(bolMore(JSON.stringify({ data: { publicWishlist: { __typename: 'Found', wishlist } } }), base)).toEqual(expected)
    expect(bolMore(JSON.stringify({ errors: [{ message: 'PersistedQueryNotFound' }] }), base)).toBeNull()
    expect(bolMore(JSON.stringify({ data: { wishlist: null } }), base)).toBeNull()
    expect(bolMore('<html>Access Denied</html>', base)).toBeNull()
  })
})

describe('a wishlist someone shares at Amazon', () => {
  const base = 'https://www.amazon.nl/hz/wishlist/ls/L1ST'

  it('gives every item its name, the product\'s own address and a larger picture', () => {
    const page = amazonPage([
      amazonItem('I36KK8N7QFQ15U', '0141012692', 'Extremely loud &amp; incredibly close: Jonathan Safran Foer', 'https://m.media-amazon.com/images/I/51+j4C3S32L._SS135_.jpg'),
      amazonItem('I38I1MJ9GWJNXD', '9463360115', 'Fabeldieren: en waar ze te vinden'),
    ])
    expect(amazonList(page, base)).toEqual({
      items: [
        { title: 'Extremely loud & incredibly close: Jonathan Safran Foer', url: 'https://www.amazon.nl/dp/0141012692', image: 'https://m.media-amazon.com/images/I/51+j4C3S32L._SL500_.jpg' },
        { title: 'Fabeldieren: en waar ze te vinden', url: 'https://www.amazon.nl/dp/9463360115', image: 'https://m.media-amazon.com/images/I/9463360115._SL500_.jpg' },
      ],
      total: null,
      next: null,
    })
  })

  it('names the next page until the page carries the end of the list', () => {
    const next = '/hz/wishlist/slv/items?filter=unpurchased&amp;paginationToken=eyJGcm9tVVVJRCI6IjEifQ&amp;lid=L1ST'
    expect(amazonList(amazonPage([amazonItem('I1', '0000000001', 'Een')], next), base).next)
      .toBe('https://www.amazon.nl/hz/wishlist/slv/items?filter=unpurchased&paginationToken=eyJGcm9tVVVJRCI6IjEifQ&lid=L1ST')
    expect(amazonList(amazonPage([amazonItem('I1', '0000000001', 'Een')]), base).next).toBeNull()
  })

  it('follows no next page that leads somewhere else', () => {
    for (const next of ['https://shop.example/hz/wishlist/slv/items', '//shop.example/hz/wishlist/slv/items', '/gp/aw/d/0141012692', 'javascript:alert(1)']) {
      expect(amazonList(amazonPage([amazonItem('I1', '0000000001', 'Een')], next), base).next, next).toBeNull()
    }
  })

  it('keeps an item without a picture, and takes no picture from anywhere but Amazon\'s own', () => {
    const page = amazonPage([amazonItem('I1', '0000000001', 'Een', 'https://shop.example/images/I/een._SS135_.jpg'), amazonItem('I2', '0000000002', 'Twee', '/images/G/01/wishlist/placeholder.png')])
    expect(amazonList(page, base).items).toEqual([{ title: 'Een', url: 'https://www.amazon.nl/dp/0000000001' }, { title: 'Twee', url: 'https://www.amazon.nl/dp/0000000002' }])
  })

  it('finds nothing on a page that is no list', () => {
    expect(amazonList('<html><body><form action="/errors/validateCaptcha"><input name="amzn"></form></body></html>', base)).toEqual({ items: [], total: null, next: null })
  })
})

describe('what a product\'s page calls the product', () => {
  const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`

  it('takes the product\'s name from what the page tells search engines', () => {
    const page = `<html><head><title>Lamp kopen? | Shop</title><meta property="og:title" content="Lamp | Shop">
      ${ld({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', 'name': 'Kruimels' })}
      ${ld({ '@context': 'https://schema.org', '@type': 'Product', 'name': '  Staande lamp\n Aalst &amp; co ', 'offers': { price: '49.99' } })}</head></html>`
    expect(pageTitle(page)).toBe('Staande lamp Aalst & co')
  })

  it('finds the product among several things, in a graph, and under more than one type', () => {
    expect(pageTitle(ld([{ '@type': 'Organization', 'name': 'Shop' }, { '@type': 'Product', 'name': 'Lamp' }]))).toBe('Lamp')
    expect(pageTitle(ld({ '@graph': [{ '@type': 'WebPage', 'name': 'Pagina' }, { '@type': ['Book', 'Product'], 'name': 'Boek' }] }))).toBe('Boek')
    expect(pageTitle(ld({ '@type': 'WebPage', 'name': 'Pagina', 'mainEntity': { '@type': 'Product', 'name': 'Stoel' } }))).toBe('Stoel')
    expect(pageTitle(`<SCRIPT TYPE='application/ld+json'>{"@type":"product","name":"Kast"}</SCRIPT>`)).toBe('Kast')
  })

  it('falls back on the page\'s own titles, in this order', () => {
    const head = (parts: string) => `<html><head>${parts}</head><body><h1>Iets anders</h1></body></html>`
    const og = '<meta property="og:title" content="Lamp (og)">'
    const twitter = '<meta name="twitter:title" content="Lamp (twitter)">'
    const title = '<title>Lamp &amp; kap | Shop</title>'
    expect(pageTitle(head(title + twitter + og))).toBe('Lamp (og)')
    expect(pageTitle(head(title + twitter))).toBe('Lamp (twitter)')
    expect(pageTitle(head(title))).toBe('Lamp & kap | Shop')
    // What search engines are told is broken or about something else: the titles still count.
    expect(pageTitle(head(`<script type="application/ld+json">{ "@type": "Product", </script>${og}`))).toBe('Lamp (og)')
    expect(pageTitle(head(`${ld({ '@type': 'Organization', 'name': 'Shop' })}${title}`))).toBe('Lamp & kap | Shop')
  })

  it('reads nothing from a script or a comment, and names nothing when the page doesn\'t', () => {
    expect(pageTitle('<script>var a = \'<title>Nep</title><meta property="og:title" content="Nep">\'</script><!-- <title>Nep</title> -->')).toBeNull()
    expect(pageTitle('<html><head><title>   </title><meta property="og:title" content=""></head></html>')).toBeNull()
    expect(pageTitle('')).toBeNull()
    expect(pageTitle('<script type="application/ld+json">{"@type":"Product","name":"Nooit dicht"}')).toBeNull()
  })

  it('reads a page made of script openers in a moment', () => {
    const started = Date.now()
    expect(pageTitle('<script type="application/ld+json">'.repeat(40_000))).toBeNull()
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

// A shop on this machine. Each test sets what it answers.
type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 7)])

let server: Server
let port: number
let routes: Record<string, Handler> = {}
let seen: { method: string, url: string, headers: IncomingMessage['headers'], body: string }[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body })
      const handler = routes[req.url!.split('?')[0]!]
      if (handler) handler(req, res, body)
      else res.writeHead(404).end('not here')
    })
  })
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
})

/** Every name is this machine, and only this machine may be reached: what a test needs and the site never allows. */
const local: FetchPolicy = {
  resolve: async () => ['127.0.0.1'],
  allowsAddress: ip => ip === '127.0.0.1',
  allowsPort: () => true,
}
const shop = (path = '/') => `http://shop.test:${port}${path}`
const html = (body: string): Handler => (_req, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body)
const json = (data: unknown): Handler => (_req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
const product = (name: string) => html(`<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name })}</script></head></html>`)
/** The shop on this machine keeps its lists where the real shops do, under other addresses. */
const recognise = (link: URL): ShopList | null => {
  if (link.pathname === '/bol-list') return { shop: 'bol', id: LIST_ID, page: shop('/bol-list'), api: shop('/api/graphql') }
  if (link.pathname === '/amazon-list') return { shop: 'amazon', page: shop('/hz/wishlist/ls/L1ST') }
  return null
}
const read = (text: string, options: Parameters<typeof readImport>[1] = {}) => readImport(text, { policy: local, recognise, ...options })

describe('reading what someone pasted', () => {
  it('fetches nothing for a text without a link', async () => {
    expect(await read('een nieuwe fiets, en sokken')).toEqual({ items: [], unread: [], short: null })
    expect(seen).toEqual([])
  })

  it('reads each product page for its name, and keeps the links\' order', async () => {
    routes['/lamp'] = product('Staande lamp')
    routes['/boek'] = html('<html><head><meta property="og:title" content="Dik boek"></head></html>')
    routes['/stoel'] = (_req, res) => setTimeout(() => product('Stoel')(_req, res, ''), 60)
    const found = await read(`${shop('/stoel')}\n${shop('/lamp')} ${shop('/boek?druk=2')}`)
    expect(found).toEqual({
      items: [
        { title: 'Stoel', url: shop('/stoel') },
        { title: 'Staande lamp', url: shop('/lamp') },
        { title: 'Dik boek', url: shop('/boek?druk=2') },
      ],
      unread: [],
      short: null,
    })
  })

  it('calls a product at Amazon what its page calls it, without the shop\'s name after it', async () => {
    const amazon = (link: URL): ShopList | null => recognise(link)
    routes['/dp/0141012692'] = html(`<html><head><title>Extremely loud &amp; incredibly close: Foer, Jonathan Safran: Amazon.nl: Boeken</title></head>
      <body><h1 id="title"><span id="productTitle" class="a-size-large celwidget">   Extremely loud &amp; incredibly close   </span></h1></body></html>`)
    // The shop on this machine isn't Amazon, so its page is read like any other.
    expect((await read(shop('/dp/0141012692'), { recognise: amazon })).items[0]!.title).toBe('Extremely loud & incredibly close: Foer, Jonathan Safran: Amazon.nl: Boeken')
    const asAmazon: FetchPolicy = { ...local, resolve: async host => (host === 'www.amazon.nl' ? ['127.0.0.1'] : []) }
    expect((await read(`http://www.amazon.nl:${port}/dp/0141012692`, { policy: asAmazon })).items).toEqual([{ title: 'Extremely loud & incredibly close', url: `http://www.amazon.nl:${port}/dp/0141012692` }])
    routes['/dp/0141012692'] = html('<html><head><title>Een boek: Amazon.nl: Boeken</title></head><body></body></html>')
    expect((await read(`http://www.amazon.nl:${port}/dp/0141012692`, { policy: asAmazon })).items[0]!.title).toBe('Een boek: Amazon.nl: Boeken')
  })

  it('reports the links nothing came of', async () => {
    routes['/lamp'] = product('Lamp')
    routes['/leeg'] = html('<html><body>Niets</body></html>')
    routes['/foto'] = (_req, res) => res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG)
    routes['/dicht'] = (_req, res) => res.writeHead(403, { 'Content-Type': 'text/html' }).end('<title>Access Denied</title>')
    const found = await read([shop('/weg'), shop('/lamp'), shop('/leeg'), shop('/foto'), shop('/dicht')].join('\n'))
    expect(found.items).toEqual([{ title: 'Lamp', url: shop('/lamp') }])
    expect(found.unread).toEqual([shop('/weg'), shop('/leeg'), shop('/foto'), shop('/dicht')])
  })

  it('says who is asking, and sends no cookie or anything else of the visitor', async () => {
    routes['/lamp'] = product('Lamp')
    await read(shop('/lamp'))
    expect(seen).toHaveLength(1)
    expect(seen[0]!.headers['user-agent']).toBe('Pakske link preview')
    expect(Object.keys(seen[0]!.headers).sort()).toEqual(['accept', 'accept-encoding', 'connection', 'host', 'user-agent'])
  })

  it('looks a shop\'s name up once, however many links it has', async () => {
    for (const n of [1, 2, 3, 4, 5, 6]) routes[`/p/${n}`] = product(`Wens ${n}`)
    let asked = 0
    const policy: FetchPolicy = { ...local, resolve: async () => {
      asked++
      return ['127.0.0.1']
    } }
    const found = await read([1, 2, 3, 4, 5, 6].map(n => shop(`/p/${n}`)).join(' '), { policy })
    expect(found.items).toHaveLength(6)
    expect(asked).toBe(1)
  })

  it('reaches nothing that isn\'t the public internet', async () => {
    routes['/lamp'] = product('Lamp')
    const inside: FetchPolicy = { ...local, resolve: async () => ['192.168.1.1'] }
    expect(await read(`${shop('/lamp')} http://192.168.1.1/admin http://[::1]:${port}/lamp`, { policy: inside })).toEqual({
      items: [],
      unread: [shop('/lamp'), 'http://192.168.1.1/admin', `http://[::1]:${port}/lamp`],
      short: null,
    })
    expect(seen).toEqual([])
  })

  it('answers when its time is over, with what it has', async () => {
    routes['/lamp'] = product('Lamp')
    routes['/traag'] = () => {}
    const started = Date.now()
    const found = await read(`${shop('/traag')} ${shop('/lamp')} ${shop('/traag?2')}`, { timeoutMs: 400, perFetchMs: 150 })
    expect(Date.now() - started).toBeLessThan(380)
    expect(found).toEqual({ items: [{ title: 'Lamp', url: shop('/lamp') }], unread: [shop('/traag'), shop('/traag?2')], short: null })
    // And the whole paste has one clock, whatever each page is given.
    const again = Date.now()
    expect((await read([1, 2, 3, 4, 5, 6, 7, 8].map(n => shop(`/traag?${n}`)).join(' '), { timeoutMs: 200, perFetchMs: 5000 })).unread).toHaveLength(8)
    expect(Date.now() - again).toBeLessThan(600)
  })

  it('reads a list at bol.com over all its pages, with the request its own page sends', async () => {
    const pages: Record<string, unknown> = {
      'after-2': bolWishlist([['Drie', '/p/3/'], ['Vier', '/p/4/']], { total: 5, cursor: 'after-4' }),
      'after-4': bolWishlist([['Vijf', '/p/5/']], { total: 5 }),
    }
    routes['/bol-list'] = html(bolPage(bolWishlist([['Een', '/p/1/'], ['Twee', '/p/2/']], { total: 5, cursor: 'after-2' })))
    routes['/api/graphql'] = (req, res, body) => json({ data: { wishlist: pages[JSON.parse(body).variables.cursor] } })(req, res, body)
    const found = await read(shop('/bol-list'))
    expect(found).toEqual({
      items: ['Een', 'Twee', 'Drie', 'Vier', 'Vijf'].map((title, at) => ({ title, url: shop(`/p/${at + 1}/`) })),
      unread: [],
      short: null,
    })
    expect(seen.map(request => `${request.method} ${request.url}`)).toEqual(['GET /bol-list', 'POST /api/graphql', 'POST /api/graphql'])
    expect(seen.slice(1).map(request => JSON.parse(request.body).variables)).toEqual([
      { wishlistId: LIST_ID, numberOfProducts: 24, cursor: 'after-2' },
      { wishlistId: LIST_ID, numberOfProducts: 24, cursor: 'after-4' },
    ])
    expect(seen[1]!.headers).toMatchObject({ 'content-type': 'application/json', 'accept': 'application/json', 'user-agent': 'Pakske link preview' })
    expect(seen[1]!.headers.cookie).toBeUndefined()
  })

  it('keeps the first page and says how many are missing when bol.com refuses the next', async () => {
    routes['/bol-list'] = html(bolPage(bolWishlist([['Een', '/p/1/'], ['Twee', '/p/2/']], { total: 37, cursor: 'after-2' })))
    for (const refusal of [
      (_req, res) => res.writeHead(403, { 'Content-Type': 'text/html' }).end('Access Denied'),
      json({ errors: [{ message: 'PersistedQueryNotFound' }] }),
      html('<html>Even geduld</html>'),
      (_req, res) => res.writeHead(302, { Location: shop('/elders') }).end(),
      json({ data: { wishlist: bolWishlist([], { total: 37, cursor: 'after-2' }) } }),
    ] as Handler[]) {
      seen = []
      routes['/api/graphql'] = refusal
      const found = await read(shop('/bol-list'))
      expect(found.items.map(item => item.title)).toEqual(['Een', 'Twee'])
      expect(found.short).toEqual({ read: 2, total: 37 })
      expect(seen).toHaveLength(2)
    }
  })

  it('reads a list at Amazon page after page, with the pictures its list shows', async () => {
    routes['/hz/wishlist/ls/L1ST'] = html(amazonPage([amazonItem('I1', '0000000001', 'Een'), amazonItem('I2', '0000000002', 'Twee')], '/hz/wishlist/slv/items?paginationToken=two&amp;lid=L1ST'))
    routes['/hz/wishlist/slv/items'] = (req, res) => html(req.url!.includes('paginationToken=two')
      ? amazonPage([amazonItem('I3', '0000000003', 'Drie')], '/hz/wishlist/slv/items?paginationToken=three&amp;lid=L1ST')
      : amazonPage([amazonItem('I4', '0000000004', 'Vier')]))(req, res, '')
    const found = await read(shop('/amazon-list'))
    expect(found.items).toEqual(['Een', 'Twee', 'Drie', 'Vier'].map((title, at) => ({
      title,
      url: shop(`/dp/000000000${at + 1}`),
      image: `https://m.media-amazon.com/images/I/000000000${at + 1}._SL500_.jpg`,
    })))
    expect(found.short).toBeNull()
    expect(seen.map(request => request.url)).toEqual(['/hz/wishlist/ls/L1ST', '/hz/wishlist/slv/items?paginationToken=two&lid=L1ST', '/hz/wishlist/slv/items?paginationToken=three&lid=L1ST'])
  })

  it('keeps what it read of a list at Amazon when a later page is refused', async () => {
    routes['/hz/wishlist/ls/L1ST'] = html(amazonPage([amazonItem('I1', '0000000001', 'Een')], '/hz/wishlist/slv/items?paginationToken=two'))
    routes['/hz/wishlist/slv/items'] = html('<html><body><form action="/errors/validateCaptcha"></form></body></html>')
    const found = await read(shop('/amazon-list'))
    expect(found.items.map(item => item.title)).toEqual(['Een'])
    expect(found.short).toEqual({ read: 1, total: null })
  })

  it('reports a list that shows no wishes as unread', async () => {
    routes['/bol-list'] = html('<html><body>Dit lijstje is niet gedeeld</body></html>')
    routes['/hz/wishlist/ls/L1ST'] = html(amazonPage([]))
    expect(await read(`${shop('/bol-list')} ${shop('/amazon-list')}`)).toEqual({ items: [], unread: [shop('/bol-list'), shop('/amazon-list')], short: null })
  })

  it('stops at a hundred wishes and says the list holds more', async () => {
    const batch = (from: number) => Array.from({ length: 40 }, (_, n): Product => [`Wens ${from + n}`, `/p/${from + n}/`])
    routes['/bol-list'] = html(bolPage(bolWishlist(batch(0), { total: 160, cursor: '40' })))
    routes['/api/graphql'] = (req, res, body) => {
      const from = Number(JSON.parse(body).variables.cursor)
      json({ data: { wishlist: bolWishlist(batch(from), { total: 160, cursor: String(from + 40) }) } })(req, res, body)
    }
    const found = await read(shop('/bol-list'))
    expect(found.items).toHaveLength(IMPORT_MAX)
    expect(found.items.at(-1)).toEqual({ title: 'Wens 99', url: shop('/p/99/') })
    expect(found.short).toEqual({ read: 100, total: 160 })
    // Three pages hold 120: no fourth is asked for.
    expect(seen).toHaveLength(3)
  })

  it('takes a wish once when a list and a pasted link both have it', async () => {
    routes['/bol-list'] = html(bolPage(bolWishlist([['Een', '/p/1/'], ['Twee', '/p/2/']])))
    routes['/p/1/'] = product('Een, van zijn eigen pagina')
    routes['/lamp'] = product('Lamp')
    const found = await read(`${shop('/lamp')} ${shop('/bol-list')} ${shop('/p/1/')}`)
    expect(found.items.map(item => item.title)).toEqual(['Lamp', 'Een', 'Twee'])
    expect(found).toMatchObject({ unread: [], short: null })
  })
})

describe('what an import may send', () => {
  it('takes a paste of up to 16 000 characters', () => {
    expect(importReadInput.parse({ text: '  https://shop.example/lamp  ' })).toEqual({ text: 'https://shop.example/lamp' })
    expect(importReadInput.safeParse({ text: '   ' }).success).toBe(false)
    expect(importReadInput.safeParse({ text: 'a'.repeat(16001) }).success).toBe(false)
    expect(importReadInput.safeParse({}).success).toBe(false)
  })

  it('takes one to a hundred wishes, each a title and a web address', () => {
    const item = { title: ' Lamp ', url: 'https://shop.example/lamp' }
    expect(importInput.parse({ items: [item, { ...item, image: 'https://shop.example/lamp.jpg' }] })).toEqual({
      items: [{ title: 'Lamp', url: 'https://shop.example/lamp' }, { title: 'Lamp', url: 'https://shop.example/lamp', image: 'https://shop.example/lamp.jpg' }],
    })
    expect(importInput.safeParse({ items: Array.from({ length: IMPORT_MAX }, () => item) }).success).toBe(true)
    for (const items of [
      [],
      Array.from({ length: IMPORT_MAX + 1 }, () => item),
      [{ ...item, title: '' }],
      [{ ...item, title: 'x'.repeat(201) }],
      [{ ...item, url: 'javascript:alert(1)' }],
      [{ ...item, url: `https://shop.example/${'a'.repeat(2000)}` }],
      [{ ...item, image: 'data:image/png;base64,AAAA' }],
      [{ ...item, quantity: 3 }],
      [{ title: 'Lamp' }],
    ]) expect(importInput.safeParse({ items }).success, JSON.stringify(items).slice(0, 80)).toBe(false)
  })
})

describe('which found wishes the list has already', () => {
  it('goes by the link, whatever its capitals, its "www." and its closing slash', () => {
    const items = [
      { title: 'Een', url: 'https://www.bol.com/nl/nl/p/een/1/' },
      { title: 'Twee', url: 'https://www.bol.com/nl/nl/p/twee/2/' },
      { title: 'Drie', url: 'https://shop.example/p?id=3' },
      { title: 'Vier', url: 'https://shop.example/p?id=4' },
    ]
    const wishes = [
      { urls: [] },
      { urls: ['https://other.example/', 'https://bol.com/nl/nl/p/een/1#reviews'] },
      { urls: ['https://shop.example/p?id=4'] },
    ]
    expect([...alreadyListed(items, wishes)]).toEqual([0, 3])
    expect([...alreadyListed(items, [])]).toEqual([])
  })
})

describe('the pictures of imported wishes', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'import-'))
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
    const token = addList(db, art.id)
    const items = [
      { title: 'Een', url: 'https://shop.example/een' },
      { title: 'Twee', url: 'https://shop.example/twee', image: 'https://img.example/twee.jpg' },
      { title: 'Drie', url: 'https://shop.example/drie' },
    ]
    const wishes = addWishes(db, art.id, token, items)
    const wanted = wishes.map((wish, at) => ({ wishId: wish.id, url: items[at]!.url, image: items[at]!.image }))
    const view = (at: number) => wishIn(getListView(db, token, art.id), wishes[at]!.id)!
    return { db, art, token, wishes, wanted, view }
  }
  const files = () => existsSync(join(dataDir, 'uploads')) ? readdirSync(join(dataDir, 'uploads')) : []
  const cover = { data: PNG, ext: 'png' as const }

  it('takes the picture the shop\'s list showed, and else the cover of the wish\'s page, one at a time', async () => {
    const { db, art, token, wanted, view } = setup()
    const asked: string[] = []
    let out = 0
    const fetcher = (kind: string) => async (address: string) => {
      expect(++out).toBe(1)
      asked.push(`${kind} ${address}`)
      await new Promise(resolve => setTimeout(resolve, 5))
      out--
      return address.endsWith('/drie') ? null : cover
    }
    await coverImported(db, art.id, token, wanted, { page: fetcher('page'), image: fetcher('image') })
    expect(asked).toEqual(['page https://shop.example/een', 'image https://img.example/twee.jpg', 'page https://shop.example/drie'])
    expect(files()).toHaveLength(2)
    expect(view(0)).toMatchObject({ image: expect.stringMatching(/^\/uploads\/[a-f0-9]{32}\.png$/), imageFromLink: true })
    expect(view(1)).toMatchObject({ imageFromLink: true })
    expect(view(2)).toMatchObject({ image: null, imageFromLink: false })
  })

  it('goes on after a picture that fails, and keeps no file for a wish that moved on', async () => {
    const { db, art, token, wanted, view } = setup()
    await coverImported(db, art.id, token, wanted, {
      page: async (address) => {
        if (address.endsWith('/een')) throw new Error('boom')
        // The owner put up a photo while the cover was on its way.
        setWishImage(db, art.id, token, wanted[2]!.wishId, 'photo.jpg')
        return cover
      },
      image: async () => cover,
    })
    expect(view(0)).toMatchObject({ image: null })
    expect(view(1)).toMatchObject({ imageFromLink: true })
    expect(view(2)).toMatchObject({ image: '/uploads/photo.jpg', imageFromLink: false })
    expect(files()).toHaveLength(1)
  })

  it('answers when its time is over, and the pictures still come in', async () => {
    const { db, art, token, wanted, view } = setup()
    const slow = () => new Promise<typeof cover>(resolve => setTimeout(resolve, 60, cover))
    const started = Date.now()
    await coverImported(db, art.id, token, wanted, { page: slow, image: slow }, 30)
    expect(Date.now() - started).toBeLessThan(55)
    expect(view(0)).toMatchObject({ image: null })
    await vi.waitFor(() => expect(view(2)).toMatchObject({ imageFromLink: true }))
    expect(files()).toHaveLength(3)
  })

  it('lets one import\'s pictures wait for another\'s', async () => {
    const first = setup()
    const second = setup()
    const asked: string[] = []
    const fetchers = (name: string) => {
      const fetcher = async () => {
        asked.push(name)
        await new Promise(resolve => setTimeout(resolve, 5))
        return cover
      }
      return { page: fetcher, image: fetcher }
    }
    await Promise.all([
      coverImported(first.db, first.art.id, first.token, first.wanted, fetchers('first')),
      coverImported(second.db, second.art.id, second.token, second.wanted, fetchers('second')),
    ])
    expect(asked).toEqual(['first', 'first', 'first', 'second', 'second', 'second'])
  })
})
