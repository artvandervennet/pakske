export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { email: user.email, displayName: user.displayName }
})
