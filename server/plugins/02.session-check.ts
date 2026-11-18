import { findUserById, sessionBelongsTo } from '../domain/users'

// The page learns who is logged in from /api/_auth/session, which reads the cookie without
// asking the database. The API does ask (sessionUser in server/utils/http.ts). Without the same
// check here, a cookie for an account that is gone, or whose id now belongs to someone else,
// would show a name in the header while the API treats its holder as logged out.
export default defineNitroPlugin(() => {
  sessionHooks.hook('fetch', async (session, event) => {
    if (!session.user) return
    const account = findUserById(useDb(), session.user.id)
    if (account && sessionBelongsTo(session.user, account)) {
      // The cookie holds the account as it was on this device's last change. Settings may have
      // changed on another one since: the page gets the name and "anoniem geven" of today.
      Object.assign(session.user, sessionUserOf(account))
      return
    }
    await clearUserSession(event)
    // The answer is built from this object after the hook, so without a user in it the page,
    // and the session watcher in another tab, see someone logged out.
    delete session.user
  })
})
