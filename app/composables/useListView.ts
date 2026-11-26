import type { ListView } from '#shared/schemas/list'

/**
 * A list as the server lets this person see it. The server decides what is in the response, so
 * the page, and the payload Nuxt writes into the HTML, never holds more than that. A list that
 * doesn't exist, or that this person may not open, is the 404 page. For an owner who comes by an
 * address the list had before a new link, `movedTo` is where the list is now; the page goes
 * there itself, since only a page's own setup can send someone on after waiting for data.
 */
type Answer = ListView | { movedTo: string }

export async function useListView(token: MaybeRefOrGetter<string>) {
  const event = useRequestEvent()
  // On the server: the browser's cookie, so the API knows who is asking.
  const headers = useRequestHeaders(['cookie'])
  const url = () => `/api/lists/${encodeURIComponent(toValue(token))}`

  const result = await useAsyncData(() => `list:${toValue(token)}`, async () => {
    if (import.meta.server && event) {
      // Opening a list puts it on the visitor's home page, through a cookie when they aren't
      // logged in. On the server the API answers Nuxt, not the browser, so its cookies are
      // passed on to the page's own response.
      const response = await $fetch.raw<Answer>(url(), { headers })
      for (const cookie of response.headers.getSetCookie()) event.node.res.appendHeader('set-cookie', cookie)
      return response._data!
    }
    return $fetch<Answer>(url())
  })
  if (result.error.value || !result.data.value) {
    throw pageError(result.error.value?.statusCode ?? 404)
  }
  const first = result.data.value
  // Also set by a later refresh: a page left open while the list got a new link somewhere else.
  const movedTo = ref('movedTo' in first ? first.movedTo : null)
  // A refresh that fails (the connection dropped, the server is restarting) resets the data.
  // The page keeps the last list it got. While it is being sent on it has an empty one to draw.
  const nothing: ListView = { token: toValue(token), title: '', note: null, owners: [], viewerOwnsList: false, deleted: false, old: false, wishes: [] }
  const list = shallowRef('movedTo' in first ? nothing : first) as Ref<ListView>
  // A refresh answered with "not found": the list was deleted, say in another tab. The page
  // keeps the last list and says the list is gone.
  const gone = ref(false)
  watch(result.data, (value) => {
    if (!value) return
    if ('movedTo' in value) return void (movedTo.value = value.movedTo)
    list.value = value
    gone.value = false
  })
  watch(result.error, (error) => {
    if (error?.statusCode === 404) gone.value = true
  })
  return { list, gone: readonly(gone), refresh: result.refresh, movedTo: readonly(movedTo) }
}
