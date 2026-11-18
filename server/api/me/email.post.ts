import { emailChangeInput } from '../../../shared/schemas/input'
import { requestEmailChange } from '../../domain/accounts'

const WINDOW = 15 * 60 * 1000

// Another address for the account. Firebase mails the new address a link, and only a click on
// it changes anything, so a typo can't lock anyone out.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const key = `email:${user.id}`
  if (isLimited(key, 5)) fail(429, 'rate_limited')

  const input = await readInput(event, emailChangeInput)
  // Every try counts, also one that worked: each is a mail sent or a password guessed.
  countHit(key, WINDOW)
  const refreshToken = await firebaseRefreshToken(event)
  const login = await domainAsync(() => requestEmailChange(useDb(), useIdentity(), user, refreshToken, { ...input, continueUrl: loginPageUrl(event, input.locale) }, verifyPassword))
  // An account from before Firebase moved there on the way; its login gets Firebase's token now.
  await setUserSession(event, { secure: { firebaseRefreshToken: login.refreshToken } })
  return sendNoContent(event)
})
