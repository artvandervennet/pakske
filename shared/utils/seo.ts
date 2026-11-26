// What search engines may take in: the pages about the site itself, in both languages. A list,
// a link someone was sent, an account's pages and every API answer stay out, as the privacy page
// says. The server's X-Robots-Tag, robots.txt, the sitemap and each page's own robots tag all
// read this one list, so they can't disagree.

/** The site's languages: the path each one's pages start with, and the language they are in.
    The same as the locales in nuxt.config.ts, which put Dutch at /… and English at /en/…. */
export const SITE_LANGUAGES = [
  { code: 'nl', prefix: '', language: 'nl-BE' },
  { code: 'en', prefix: '/en', language: 'en-GB' },
] as const

/** The pages search engines may index, as the default language has them. */
export const INDEXED_PAGES = ['/', '/about', '/privacy', '/terms'] as const

/** A page's address in one language: "/about" in English is "/en/about", "/" is "/en". */
export function pathIn(prefix: string, page: string): string {
  return page === '/' ? prefix || '/' : prefix + page
}

/** Every address of the pages search engines may index. */
const INDEXED_PATHS = new Set(INDEXED_PAGES.flatMap(page => SITE_LANGUAGES.map(language => pathIn(language.prefix, page))))

/** The indexed page at `path` (without its query), as the default language has it; null for any other page. */
export function indexedPage(path: string): string | null {
  const bare = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  if (!INDEXED_PATHS.has(bare)) return null
  const language = SITE_LANGUAGES.find(({ prefix }) => prefix && (bare === prefix || bare.startsWith(`${prefix}/`)))
  return language ? bare.slice(language.prefix.length) || '/' : bare
}

/** The same page in each language, as whole addresses, for hreflang and the sitemap. */
export function alternates(origin: string, page: string): { language: string, href: string }[] {
  return SITE_LANGUAGES.map(language => ({ language: language.language, href: origin + pathIn(language.prefix, page) }))
}

/** Chat apps and social sites that fetch a link once when someone sends it, to show its title
    and picture with the message. They may read any page, as a visitor who isn't logged in. */
const LINK_PREVIEWERS = [
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'LinkedInBot',
  'Slackbot-LinkExpanding',
  'Discordbot',
  'TelegramBot',
  'WhatsApp',
]

/** What the pages need besides their HTML: Nuxt's scripts and styles, the translations, the icons
    and the preview picture. A search engine that may not load them can't tell what a page looks like. */
const PAGE_ASSETS = ['/_nuxt/', '/_i18n/', '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/preview.png', '/logo']

export function robotsTxt(origin: string): string {
  return [
    '# Chat apps and social sites fetch a link once when someone sends it, to show its title and',
    '# picture with the message. They may read any page, as a visitor who isn\'t logged in.',
    ...LINK_PREVIEWERS.map(agent => `User-agent: ${agent}`),
    'Allow: /',
    'Disallow: /api/',
    '',
    '# Everyone else, search engines too, only the pages about the site itself. A list, a link',
    '# someone was sent and an account\'s pages stay out, and say so themselves (X-Robots-Tag).',
    'User-agent: *',
    ...[...INDEXED_PATHS].map(path => `Allow: ${path}$`),
    ...PAGE_ASSETS.map(path => `Allow: ${path}`),
    // "/*" and not "/": a proxy may put a group of its own above this file, for every crawler,
    // that allows "/" (Cloudflare's managed robots.txt does). A crawler merges the groups, and
    // between two rules of the same length it follows the one that allows. The longer rule wins.
    'Disallow: /*',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')
}

export function sitemapXml(origin: string): string {
  const urls = INDEXED_PAGES.flatMap(page => alternates(origin, page).map(({ href }) => [
    '  <url>',
    `    <loc>${href}</loc>`,
    ...alternates(origin, page).map(alternate => `    <xhtml:link rel="alternate" hreflang="${alternate.language}" href="${alternate.href}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${alternates(origin, page)[0]!.href}"/>`,
    '  </url>',
  ]))
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls.flat(),
    '</urlset>',
    '',
  ].join('\n')
}
