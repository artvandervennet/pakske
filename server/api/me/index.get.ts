import { knownSignInMethods, signInMethods } from '../../domain/accounts'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const refreshToken = await firebaseRefreshToken(event)
  // Firebase is only asked when this login has a token for it: a login from before Firebase
  // (or a site without it set up) still gets its Settings page.
  // Asking also brings a changed address over, once the person confirmed it by mail.
  const account = user.firebaseUid && refreshToken
    ? await signInMethods(useDb(), useIdentity(), user, refreshToken)
    : { email: user.email, ...knownSignInMethods(user) }
  return { displayName: user.displayName, ...account }
})
