// Runs before every request.

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

  // Refuse large bodies before reading them. A body without a stated length could be any size,
  // so it is refused too.
  const refusal = bodyRefusal(event.method, path, getRequestHeader(event, 'content-length'), getRequestHeader(event, 'transfer-encoding'))
  if (refusal) fail(refusal, 'too_large')
})
