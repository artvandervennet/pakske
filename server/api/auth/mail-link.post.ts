import { mailLinkInput } from '../../../shared/schemas/input'
import { followMailLink, logIn } from '../../domain/accounts'

const WINDOW = 15 * 60 * 1000

// Does what the link in a mail from Firebase is for: sets the new password, confirms an address,
// changes it, or puts the old one back. Only the button on the link's page gets here, so a mail
// program that opens links to look at them uses nothing up.
export default defineEventHandler(async (event) => {
  const key = `mail-link:${clientIp(event)}`
  if (isLimited(key, 20)) fail(429, 'rate_limited')
  countHit(key, WINDOW)

  const input = await readInput(event, mailLinkInput)
  const db = useDb()
  const identity = useIdentity()
  const link = await domainAsync(() => followMailLink(db, identity, input.code, input.newPassword))
  if (!link) fail(410, 'link_gone')

  // Whoever chose the password has the mail and knows the password: they are logged in with it,
  // as if they typed it on the login page. When that fails the password is still changed, and
  // the page sends them to the login page instead.
  let loggedIn = false
  if (link.kind === 'reset_password' && input.newPassword !== undefined) {
    try {
      const result = await logIn(db, identity, link.email, input.newPassword, verifyPassword)
      if (result) {
        await startSession(event, result.user, result.login)
        loggedIn = true
      }
    }
    catch {
      // Logging in by hand says what is wrong.
    }
  }
  return { link, loggedIn }
})
