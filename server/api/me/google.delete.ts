import { unlinkGoogle } from '../../domain/accounts'

// Stops logging in with Google. Only for an account with a password to log in with instead.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const refreshToken = await firebaseRefreshToken(event)
  await domainAsync(() => unlinkGoogle(useDb(), useIdentity(), user.id, refreshToken))
  return sendNoContent(event)
})
