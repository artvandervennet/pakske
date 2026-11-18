export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return {
    email: user.email,
    displayName: user.displayName,
    hasPassword: user.passwordHash !== null,
    google: user.googleSub !== null,
  }
})
