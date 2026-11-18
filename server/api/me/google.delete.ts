import { unlinkGoogle } from '../../domain/users'

// Stops logging in with Google. Only for an account with a password to log in with instead.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  domain(() => unlinkGoogle(useDb(), user.id))
  return sendNoContent(event)
})
