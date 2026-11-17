// Runs before every request.

const SMALL_BODY = 16 * 1024
const STATIC = /^\/(_nuxt|_i18n|uploads|__nuxt)\//

export default defineEventHandler((event) => {
  const path = event.path.split('?')[0]!

  if (!STATIC.test(path) && path !== '/robots.txt') {
    // Pages and API answers depend on who is asking. Nothing in between may keep a copy.
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    appendResponseHeader(event, 'Vary', 'Cookie')
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
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
    const forwarded = useRuntimeConfig().trustProxy === true ? getRequestHeader(event, 'x-forwarded-host') : undefined
    if (originHost !== (forwarded ?? getRequestHeader(event, 'host'))) fail(403, 'bad_origin')
  }

  // Refuse large bodies before reading them. Only the image upload may be bigger. A body
  // without a stated length could be any size, so it is refused too.
  if (!['POST', 'PUT', 'PATCH'].includes(event.method)) return
  const stated = getRequestHeader(event, 'content-length')
  if (stated === undefined) fail(411, 'too_large')
  const limit = path.endsWith('/image') ? UPLOAD_MAX_BYTES + 64 * 1024 : SMALL_BODY
  const length = Number(stated)
  if (!Number.isFinite(length) || length > limit) fail(413, 'too_large')
})
