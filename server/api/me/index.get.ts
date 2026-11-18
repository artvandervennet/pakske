import { signInMethods } from '../../domain/accounts'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const methods = await signInMethods(useDb(), useIdentity(), user, await firebaseRefreshToken(event))
  return { email: user.email, displayName: user.displayName, ...methods }
})
