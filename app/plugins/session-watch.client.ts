// Keeps a tab honest about who is logged in. Logging in or out reloads the tab it happens in,
// but another tab of the same browser would keep showing what the previous person saw, such
// as who bought what. Whenever a tab comes back into view it asks the server who is logged in
// now, and reloads if that is someone else than when the page was loaded.
export default defineNuxtPlugin(() => {
  const { user } = useUserSession()
  const idAtLoad = user.value?.id ?? null
  let checking = false

  async function check() {
    if (checking || document.visibilityState !== 'visible') return
    checking = true
    try {
      const session = await $fetch<{ user?: { id: number } }>('/api/_auth/session')
      if ((session.user?.id ?? null) !== idAtLoad) window.location.reload()
    }
    catch {
      // Offline, or the server is restarting: say nothing and try again next time.
    }
    finally {
      checking = false
    }
  }

  document.addEventListener('visibilitychange', check)
  window.addEventListener('focus', check)
  // A page restored by the Back button was rendered for whoever was logged in back then.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload()
  })
})
