// How many notices and friend requests the person hasn't seen yet, for the dot on the header's
// bell. One fetch under one key, so marking them seen where they are read (the panel the bell
// opens, or the friends page for requests) takes the dot away at once.
// Logged out there is nothing to fetch: logging in and out reload the whole page.
export function useNotices() {
  const { loggedIn } = useUserSession()
  const { data, refresh } = useFetch('/api/notices/unseen', {
    key: 'notices-unseen',
    immediate: loggedIn.value,
    default: () => ({ unseen: 0 }),
  })

  const unseen = computed(() => data.value.unseen)

  // The dot also counts friend requests that wait for an answer; seeing them takes it away,
  // though each stays until it is answered.
  async function markSeen() {
    await Promise.all([
      $fetch('/api/notices/seen', { method: 'POST' }),
      $fetch<unknown>('/api/friends/requests/seen', { method: 'POST' }),
    ])
    data.value = { unseen: 0 }
  }

  /** The friends page shows the requests but not the notices: only those are seen there. */
  async function markRequestsSeen() {
    await $fetch<unknown>('/api/friends/requests/seen', { method: 'POST' })
    await refresh()
  }

  return { unseen, markSeen, markRequestsSeen }
}
