import type { H3Event } from 'h3'
import { linkGoogle, logInWithGoogle, type GoogleCredential } from '../../domain/accounts'
import { DomainError } from '../../domain/errors'
import { localeOfPath } from '../../domain/users'

// Logging in with Google, and linking Google to an account from Settings. A page sends the
// browser here with `?from=` (the page to come back to with a problem) and `?next=` (where to go
// after logging in); Settings adds `?link=1`. This route sends it on to Google, and Google sends
// it back here with a code (nuxt-auth-utils checks the state that ties the two together).
// What the pages asked for waits in a short cookie in between. Google's answer then goes to
// Firebase, which holds the link between the Google account and the account here.

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
  async onSuccess(_, { tokens, user: profile }) {
    const flow = takeFlow(event)
    const db = useDb()
    const identity = useIdentity()
    const credential: GoogleCredential = {
      idToken: typeof tokens.id_token === 'string' ? tokens.id_token : undefined,
      accessToken: typeof tokens.access_token === 'string' ? tokens.access_token : undefined,
      requestUri: googleRedirectUrl(event),
      email: typeof profile?.email === 'string' ? profile.email : undefined,
    }
    try {
      if (flow.link !== null) {
        // Only the account that asked, still logged in, gets linked.
        if ((await sessionUserId(event)) !== flow.link) return back(event, flow, 'unauthorized')
        const login = await linkGoogle(db, identity, flow.link, await firebaseRefreshToken(event), credential)
        await setUserSession(event, { secure: { firebaseRefreshToken: login.refreshToken } })
        return sendRedirect(event, withQuery(flow.from, { google: 'linked' }))
      }
      // A new account's first list is named in the language of the page the person came from.
      const { user, login } = await logInWithGoogle(db, identity, credential, { maxUsers: Number(useRuntimeConfig().maxUsers), locale: localeOfPath(flow.from) })
      await startSession(event, user, login)
      return sendRedirect(event, flow.next ?? '/')
    }
    catch (error) {
      if (error instanceof DomainError) return back(event, flow, error.code)
      throw error
    }
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
    // Google or the network failed between the code and the profile. What kind of error and
    // its status only: the error itself can carry the answer it came with, and so an address.
    const status = (error as { statusCode?: unknown })?.statusCode
    console.error('[pakske] Google login failed:', error instanceof Error ? error.name : 'unknown error', typeof status === 'number' ? status : '')
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

/** The address Google sends the person back to: set in .env, or this route's own. */
function googleRedirectUrl(event: H3Event): string {
  const configured = useRuntimeConfig().oauth?.google?.redirectURL
  if (configured) return configured
  const url = getRequestURL(event, { xForwardedProto: true })
  return `${url.origin}${url.pathname}`
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
