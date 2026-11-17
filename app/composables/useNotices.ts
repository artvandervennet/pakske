// How many notices the person hasn't seen yet. The header and the home page share one fetch
// under one key, so marking them seen on the home page takes the header's mark away at once.
// Logged out there is nothing to fetch: logging in and out reload the whole page.
export function useNotices() {
  const { loggedIn } = useUserSession()
  const { data } = useFetch('/api/notices/unseen', {
    key: 'notices-unseen',
    immediate: loggedIn.value,
    default: () => ({ unseen: 0 }),
  })

  const unseen = computed(() => data.value.unseen)

  async function markSeen() {
    await $fetch('/api/notices/seen', { method: 'POST' })
    data.value = { unseen: 0 }
  }

  return { unseen, markSeen }
}
