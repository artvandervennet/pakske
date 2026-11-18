import { loginInput } from '../../../shared/schemas/input'
import { logIn } from '../../domain/accounts'

const WINDOW = 15 * 60 * 1000

export default defineEventHandler(async (event) => {
  const input = await readInput(event, loginInput)
  const accountKey = `login:account:${input.email}`
  const ipKey = `login:ip:${clientIp(event)}`
  if (isLimited(accountKey, 5) || isLimited(ipKey, 20)) fail(429, 'rate_limited')

  const result = await logIn(useDb(), useIdentity(), input.email, input.password, verifyPassword)
  // One answer for "no such account", "wrong password" and "this account logs in with Google".
  if (!result) {
    countHit(accountKey, WINDOW)
    countHit(ipKey, WINDOW)
    fail(401, 'invalid_credentials')
  }

  clearHits(accountKey)
  await startSession(event, result.user, result.login)
  return { displayName: result.user.displayName }
})
