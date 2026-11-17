// For pages that only make sense when logged in. Sends everyone else to the login page and
// remembers where they were going.
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  if (loggedIn.value) return
  const localePath = useLocalePath()
  return navigateTo({ path: localePath('/login'), query: { next: to.fullPath } })
})
