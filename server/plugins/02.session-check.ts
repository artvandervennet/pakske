import { findUserById, sessionBelongsTo } from '../domain/users'

// The page learns who is logged in from /api/_auth/session, which reads the cookie without
// asking the database. The API does ask (sessionUser in server/utils/http.ts). Without the same
// check here, a cookie for an account that is gone, or whose id now belongs to someone else,
// would show a name in the header while the API treats its holder as logged out.
export default defineNitroPlugin(() => {
  sessionHooks.hook('fetch', async (session, event) => {
    if (!session.user) return
    if (sessionBelongsTo(session.user, findUserById(useDb(), session.user.id))) return
    await clearUserSession(event)
    // The answer is built from this object after the hook, so without a user in it the page,
    // and the session watcher in another tab, see someone logged out.
    delete session.user
  })
})
