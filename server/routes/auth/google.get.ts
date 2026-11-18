import type { H3Event } from 'h3'
import { linkGoogle, logInWithGoogle } from '../../domain/users'
import { DomainError } from '../../domain/errors'
import { mergeVisits } from '../../domain/visits'

// Logging in with Google, and linking Google to an account from Settings. A page sends the
// browser here with `?from=` (the page to come back to with a problem) and `?next=` (where to go
// after logging in); Settings adds `?link=1`. This route sends it on to Google, and Google sends
// it back here with a code (nuxt-auth-utils checks the state that ties the two together).
// What the pages asked for waits in a short cookie in between.

const FLOW = 'google-flow'

interface Flow {
  from: string
  next: string | null
  // The account that asked to link, from its own Settings page.
  link: number | null
}

// Made per request, so its answers are written with this route's own request.
const google = (event: H3Event) => defineOAuthGoogleEventHandler({
  config: { scope: ['openid', 'email', 'profile'], authorizationParams: { prompt: 'select_account' } },
  async onSuccess(_, { user: profile }) {
    const flow = takeFlow(event)
    const db = useDb()
    const me = await sessionUserId(event)

    if (flow.link !== null) {
      // Only the account that asked, still logged in, gets linked.
      if (me !== flow.link) return back(event, flow, 'unauthorized')
      try {
        linkGoogle(db, me, String(profile.sub))
      }
      catch (error) {
        if (error instanceof DomainError) return back(event, flow, error.code)
        throw error
      }
      return sendRedirect(event, withQuery(flow.from, { google: 'linked' }))
    }

    let user
    try {
      user = logInWithGoogle(db, {
        sub: String(profile.sub),
        email: String(profile.email ?? ''),
        emailVerified: profile.email_verified === true,
        name: typeof profile.name === 'string' ? profile.name : null,
      }, { maxUsers: Number(useRuntimeConfig().maxUsers) })
    }
    catch (error) {
      if (error instanceof DomainError) return back(event, flow, error.code)
      throw error
    }
    await replaceUserSession(event, { user: sessionUserOf(user) })
    // As with a password: the lists opened while logged out move into the account.
    mergeVisits(db, user.id, readOpened(event))
    clearOpened(event)
    return sendRedirect(event, flow.next ?? '/')
  },
  onError() {
    return back(event, takeFlow(event), 'google_failed')
  },
})

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  // Back from Google without a code: the person said no, or Google did. Back to where they were.
  if (query.state && !query.code) {
    deleteCookie(event, 'nuxt-auth-state', { path: '/' })
    return sendRedirect(event, takeFlow(event).from)
  }
  if (!query.code) {
    const origin = getRequestURL(event).origin
    const flow: Flow = {
      from: safeNextPath(query.from, origin) ?? '/login',
      next: safeNextPath(query.next, origin),
      link: null,
    }
    if (query.link) {
      // Linking changes the account, so only Settings on this site may start it: a link on
      // another site could otherwise tie someone's account to whatever Google account their
      // browser is logged into.
      const site = getRequestHeader(event, 'sec-fetch-site')
      if (site && site !== 'same-origin') fail(403, 'bad_origin')
      flow.link = await sessionUserId(event)
      if (flow.link === null) return sendRedirect(event, withQuery(flow.from, { google: 'unauthorized' }))
    }
    setCookie(event, FLOW, JSON.stringify(flow), {
      httpOnly: true,
      sameSite: 'lax',
      secure: useRuntimeConfig().session.cookie?.secure !== false,
      path: '/auth/google',
      maxAge: 10 * 60,
    })
  }
  try {
    return await google(event)(event as never)
  }
  catch (error) {
    // Google or the network failed between the code and the profile.
    console.error(error)
    return back(event, takeFlow(event), 'google_failed')
  }
})

/** What the page asked for, read once. Without the cookie: the login page, then home. */
function takeFlow(event: H3Event): Flow {
  const raw = getCookie(event, FLOW)
  deleteCookie(event, FLOW, { path: '/auth/google' })
  try {
    const flow = JSON.parse(raw ?? '') as Partial<Flow>
    const origin = getRequestURL(event).origin
    return {
      from: safeNextPath(flow.from, origin) ?? '/login',
      next: safeNextPath(flow.next, origin),
      link: typeof flow.link === 'number' ? flow.link : null,
    }
  }
  catch {
    return { from: '/login', next: null, link: null }
  }
}

/** A path on this site with one more query parameter. */
function withQuery(path: string, query: Record<string, string>): string {
  const url = new URL(path, 'http://site.invalid')
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  return url.pathname + url.search + url.hash
}

/** Back to the page that started it, with the reason it didn't work for that page to say. */
function back(event: H3Event, flow: Flow, code: string) {
  return sendRedirect(event, withQuery(flow.from, { google: code }))
}
