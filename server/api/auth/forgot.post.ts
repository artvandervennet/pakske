import { forgotInput } from '../../../shared/schemas/input'

const HOUR = 60 * 60 * 1000

// "Wachtwoord vergeten": Firebase mails a link to choose a new password. The answer is the same
// whether the address has an account or not.
export default defineEventHandler(async (event) => {
  const input = await readInput(event, forgotInput)
  const accountKey = `forgot:account:${input.email}`
  const ipKey = `forgot:ip:${clientIp(event)}`
  if (isLimited(accountKey, 3) || isLimited(ipKey, 10)) fail(429, 'rate_limited')
  countHit(accountKey, HOUR)
  countHit(ipKey, HOUR)
  await sendResetMail(event, input.email, input.locale)
  return sendNoContent(event)
})
