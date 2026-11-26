import { describe, expect, it } from 'vitest'
import { alternates, indexedPage, robotsTxt, sitemapXml } from '../shared/utils/seo'

// Search engines may take in the pages about the site itself and nothing else. The server's
// header, robots.txt, the sitemap and each page's robots tag are all built from indexedPage and
// the list it reads, so these checks cover all four.

const origin = 'https://pakske.example'

describe('the pages search engines may index', () => {
  it.each([
    ['/', '/'],
    ['/about', '/about'],
    ['/privacy', '/privacy'],
    ['/terms', '/terms'],
    ['/en', '/'],
    ['/en/', '/'],
    ['/en/about', '/about'],
    ['/en/privacy', '/privacy'],
    ['/en/terms', '/terms'],
    ['/about/', '/about'],
  ])('include %s, the page %s', (path, page) => {
    expect(indexedPage(path)).toBe(page)
  })

  it.each([
    '/l/JpCenY6Oea7uXrqEHNWwKQ',
    '/en/l/JpCenY6Oea7uXrqEHNWwKQ',
    '/j/abc',
    '/f/abc',
    '/s/abc',
    '/lists',
    '/friends',
    '/santa',
    '/settings',
    '/login',
    '/register',
    '/forgot',
    '/auth/action',
    '/api/home',
    '/api/lists/abc',
    '/uploads/abc.jpg',
    '/en/settings',
    '/aboutx',
    '/about/more',
    '/enabout',
    '/de/about',
  ])('leave out %s', (path) => {
    expect(indexedPage(path)).toBeNull()
  })
})

describe('robots.txt', () => {
  const robots = robotsTxt(origin)
  const groups = robots.split('\n\n')
  const everyone = groups.find(group => group.includes('User-agent: *'))!.split('\n')

  it('closes everything to search engines but the indexed pages and what they load', () => {
    expect(everyone).toContain('Disallow: /*')
    for (const path of ['/', '/about', '/privacy', '/terms', '/en', '/en/about', '/en/privacy', '/en/terms']) {
      expect(everyone).toContain(`Allow: ${path}$`)
    }
    expect(everyone).toContain('Allow: /_nuxt/')
    expect(everyone.filter(line => /^Allow: \/(l|j|f|s|api|uploads|lists|settings)\b/.test(line))).toEqual([])
  })

  it('lets the apps that show a link in a chat read any page, but not the API', () => {
    const previewers = groups.find(group => group.includes('User-agent: WhatsApp'))!.split('\n')
    expect(previewers).toContain('User-agent: facebookexternalhit')
    expect(previewers).toContain('Allow: /')
    expect(previewers).toContain('Disallow: /api/')
  })

  // Cloudflare's managed robots.txt goes above the site's own, with a group for every crawler
  // that allows everything. A crawler merges the two groups: the longest rule that matches wins,
  // and of two as long the one that allows (RFC 9309, and Google's own matching).
  it('keeps its rules when a proxy puts a group above it that allows everything', () => {
    const merged = `User-agent: *\nAllow: /\n\n${robots}`
    const rules = merged.split('\n\n')
      .filter(group => group.split('\n').includes('User-agent: *'))
      .flatMap(group => group.split('\n').filter(line => /^(Allow|Disallow): /.test(line)))
      .map((line) => {
        const [kind, pattern] = line.split(': ') as [string, string]
        const source = pattern.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
        return { allow: kind === 'Allow', length: pattern.length, test: new RegExp(`^${source}`) }
      })
    const allowed = (path: string) => {
      const matches = rules.filter(rule => rule.test.test(path))
      const longest = Math.max(...matches.map(rule => rule.length))
      return matches.some(rule => rule.length === longest && rule.allow)
    }
    for (const path of ['/', '/en', '/about', '/en/terms', '/_nuxt/entry.js', '/preview.png']) expect(allowed(path), path).toBe(true)
    for (const path of ['/l/JpCenY6Oea7uXrqEHNWwKQ', '/lists', '/settings', '/j/abc', '/aboutx', '/api/home', '/uploads/a.jpg']) expect(allowed(path), path).toBe(false)
  })

  it('points to the sitemap by its whole address', () => {
    expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`)
  })
})

describe('the sitemap', () => {
  const sitemap = sitemapXml(origin)
  const locs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1])

  it('lists every indexed page in both languages, and nothing else', () => {
    expect(locs.sort()).toEqual([
      `${origin}/`, `${origin}/about`, `${origin}/en`, `${origin}/en/about`,
      `${origin}/en/privacy`, `${origin}/en/terms`, `${origin}/privacy`, `${origin}/terms`,
    ].sort())
  })

  it('names the same page in the other language beside each one, Dutch by default', () => {
    expect(sitemap).toContain(`<xhtml:link rel="alternate" hreflang="en-GB" href="${origin}/en/about"/>`)
    expect(sitemap).toContain(`<xhtml:link rel="alternate" hreflang="x-default" href="${origin}/about"/>`)
    expect(sitemap.match(/hreflang="x-default"/g)).toHaveLength(locs.length)
  })

  it('is XML a search engine can read', () => {
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true)
    expect(sitemap.match(/<url>/g)).toHaveLength(sitemap.match(/<\/url>/g)!.length)
  })
})

describe('the same page in each language', () => {
  it('is the Dutch address and the English one', () => {
    expect(alternates(origin, '/')).toEqual([{ language: 'nl-BE', href: `${origin}/` }, { language: 'en-GB', href: `${origin}/en` }])
    expect(alternates(origin, '/terms')).toEqual([{ language: 'nl-BE', href: `${origin}/terms` }, { language: 'en-GB', href: `${origin}/en/terms` }])
  })
})
