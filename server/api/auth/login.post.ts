import { loginInput } from '../../../shared/schemas/input'
import { findUserByEmail } from '../../domain/users'
import { mergeVisits } from '../../domain/visits'

const WINDOW = 15 * 60 * 1000

export default defineEventHandler(async (event) => {
  const input = await readInput(event, loginInput)
  const accountKey = `login:account:${input.email}`
  const ipKey = `login:ip:${clientIp(event)}`
  if (isLimited(accountKey, 5) || isLimited(ipKey, 20)) fail(429, 'rate_limited')

  const db = useDb()
  const user = findUserByEmail(db, input.email)
  // One answer for "no such account", "wrong password" and "this account logs in with Google".
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
    countHit(accountKey, WINDOW)
    countHit(ipKey, WINDOW)
    fail(401, 'invalid_credentials')
  }

  clearHits(accountKey)
  await replaceUserSession(event, { user: sessionUserOf(user) })
  // The lists opened while logged out move into the account, so the cookie isn't needed any more.
  mergeVisits(db, user.id, readOpened(event))
  clearOpened(event)
  return { displayName: user.displayName }
})
