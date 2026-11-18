import { passwordInput } from '../../../shared/schemas/input'
import { changePassword } from '../../domain/accounts'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const key = `password:${user.id}`
  if (isLimited(key, 5)) fail(429, 'rate_limited')

  const input = await readInput(event, passwordInput)
  try {
    const refreshToken = await firebaseRefreshToken(event)
    const login = await domainAsync(() => changePassword(useDb(), useIdentity(), user, input.currentPassword, input.newPassword, verifyPassword, refreshToken))
    // Firebase ends every other login of the account; this one goes on with its new token.
    await setUserSession(event, { secure: { firebaseRefreshToken: login.refreshToken } })
  }
  catch (error) {
    countHit(key, 15 * 60 * 1000)
    throw error
  }
  clearHits(key)
  return sendNoContent(event)
})
