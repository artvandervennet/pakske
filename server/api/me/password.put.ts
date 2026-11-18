import { passwordInput } from '../../../shared/schemas/input'
import { setPasswordHash } from '../../domain/users'

const WINDOW = 15 * 60 * 1000

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const key = `password:${user.id}`
  if (isLimited(key, 5)) fail(429, 'rate_limited')

  const input = await readInput(event, passwordInput)
  // An account made with Google has no password yet: it sets one without the old one. Being
  // logged in is the proof here, as it was for making the account.
  if (user.passwordHash && !(await verifyPassword(user.passwordHash, input.currentPassword ?? ''))) {
    countHit(key, WINDOW)
    fail(403, 'wrong_password')
  }
  setPasswordHash(useDb(), user.id, await hashPassword(input.newPassword))
  clearHits(key)
  return sendNoContent(event)
})
