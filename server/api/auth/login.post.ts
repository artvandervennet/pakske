import { loginInput } from '../../../shared/schemas/input'
import { findUserByEmail } from '../../domain/users'

const WINDOW = 15 * 60 * 1000

export default defineEventHandler(async (event) => {
  const input = await readInput(event, loginInput)
  const accountKey = `login:account:${input.email}`
  const ipKey = `login:ip:${clientIp(event)}`
  if (isLimited(accountKey, 5) || isLimited(ipKey, 20)) fail(429, 'rate_limited')

  const user = findUserByEmail(useDb(), input.email)
  // One answer for "no such account" and "wrong password".
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    countHit(accountKey, WINDOW)
    countHit(ipKey, WINDOW)
    fail(401, 'invalid_credentials')
  }

  clearHits(accountKey)
  await replaceUserSession(event, { user: { id: user.id, username: user.username, displayName: user.displayName } })
  return { username: user.username }
})
