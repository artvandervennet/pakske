import { passwordMailInput } from '../../../shared/schemas/input'

// An account made with Google that wants a password too: Firebase mails a link to choose one.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const key = `password-mail:${user.id}`
  if (isLimited(key, 3)) fail(429, 'rate_limited')
  const input = await readInput(event, passwordMailInput)
  countHit(key, 60 * 60 * 1000)
  await sendResetMail(event, user.email, input.locale)
  return sendNoContent(event)
})
