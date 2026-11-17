export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { email: user.email, username: user.username, displayName: user.displayName, listIntro: user.listIntro }
})
