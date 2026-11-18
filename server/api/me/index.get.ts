import { knownSignInMethods, signInMethods } from '../../domain/accounts'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const refreshToken = await firebaseRefreshToken(event)
  // Firebase is only asked when this login has a token for it: a login from before Firebase
  // (or a site without it set up) still gets its Settings page.
  const methods = user.firebaseUid && refreshToken
    ? await signInMethods(useDb(), useIdentity(), user, refreshToken)
    : knownSignInMethods(user)
  return { email: user.email, displayName: user.displayName, ...methods }
})
