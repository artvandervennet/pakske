// Runs before every request.

import { indexedPage } from '../../shared/utils/seo'

const STATIC = /^\/(_nuxt|_i18n|uploads|__nuxt)\//

// Half a year: how long a browser that has seen the site over HTTPS keeps asking for it that way.
const HSTS = 'max-age=15552000'

export default defineEventHandler((event) => {
  const path = event.path.split('?')[0]!

  // The login cookie is only sent over HTTPS (NUXT_SESSION_COOKIE_SECURE). On a page fetched
  // over plain http its holder looks logged out, and logging in there does nothing. A tunnel
  // or proxy that also answers http says so in X-Forwarded-Proto: that visitor goes to the
  // same page over https, where the cookie is.
  const config = useRuntimeConfig()
  if (config.trustProxy === true && config.session.cookie?.secure !== false) {
    const forwardedProto = getRequestHeader(event, 'x-forwarded-proto')
    const secure = httpsAddress(forwardedProto, getRequestHeader(event, 'x-forwarded-host') ?? getRequestHeader(event, 'host'), event.path)
    // 308, so a form sent over http arrives as the same request.
    if (secure) return sendRedirect(event, secure, 308)
    if (forwardedScheme(forwardedProto) === 'https') setResponseHeader(event, 'Strict-Transport-Security', HSTS)
  }

  if (!STATIC.test(path) && path !== '/robots.txt' && path !== '/sitemap.xml') {
    // Pages and API answers depend on who is asking. Nothing in between may keep a copy.
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    appendResponseHeader(event, 'Vary', 'Cookie')
    // Search engines may index the pages about the site itself and nothing else (shared/utils/seo.ts).
    if (!indexedPage(path)) setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  }
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Referrer-Policy', 'same-origin')
  setResponseHeader(event, 'X-Frame-Options', 'DENY')

  if (!path.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(event.method)) return

  // A browser sends Origin with every request that changes something. If it names another
  // site, that site is trying to act as the logged-in person.
  const origin = getRequestHeader(event, 'origin')
  if (origin) {
    let originHost: string | undefined
    try {
      originHost = new URL(origin).host
    }
    catch { /* not a URL: refused below */ }
    const forwarded = config.trustProxy === true ? getRequestHeader(event, 'x-forwarded-host') : undefined
    if (originHost !== (forwarded ?? getRequestHeader(event, 'host'))) fail(403, 'bad_origin')
  }

  // Refuse large bodies before reading them. A body without a stated length could be any size,
  // so it is refused too.
  const refusal = bodyRefusal(event.method, path, getRequestHeader(event, 'content-length'), getRequestHeader(event, 'transfer-encoding'))
  if (refusal) fail(refusal, 'too_large')
})
