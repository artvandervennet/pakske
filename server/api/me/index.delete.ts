import { accountDeleteInput } from '../../../shared/schemas/input'
import { deleteAccount } from '../../domain/accounts'

const WINDOW = 15 * 60 * 1000

// Deletes the account for good: at Firebase, then here, with everything it ticked on other
// people's lists. Its own lists and its notes stay, without a name. Then the login cookie goes,
// and Firebase's token with it.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const key = `delete:${user.id}`
  if (isLimited(key, 5)) fail(429, 'rate_limited')

  const input = await readInput(event, accountDeleteInput)
  const refreshToken = await firebaseRefreshToken(event)
  let unused: string[]
  try {
    ({ unused } = await domainAsync(() => deleteAccount(useDb(), useIdentity(), user, refreshToken, input.currentPassword, verifyPassword)))
  }
  catch (error) {
    // A wrong password counts, so an open browser is no way to guess it.
    countHit(key, WINDOW)
    throw error
  }
  clearHits(key)
  await removeUploads(unused)
  await clearUserSession(event)
  return sendNoContent(event)
})
