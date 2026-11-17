import type { ListView } from '#shared/schemas/list'

/**
 * A list as the server lets this person see it. The server decides what is in the response, so
 * the page, and the payload Nuxt writes into the HTML, never holds more than that. A list that
 * doesn't exist, or that this person may not open, is the 404 page.
 */
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
      const response = await $fetch.raw<ListView>(url(), { headers })
      for (const cookie of response.headers.getSetCookie()) event.node.res.appendHeader('set-cookie', cookie)
      return response._data!
    }
    return $fetch<ListView>(url())
  })
  if (result.error.value || !result.data.value) {
    throw createError({ statusCode: result.error.value?.statusCode ?? 404, fatal: true })
  }
  // A refresh that fails (the connection dropped, the server is restarting) resets the data.
  // The page keeps the last list it got.
  const list = shallowRef(result.data.value) as Ref<ListView>
  watch(result.data, (value) => {
    if (value) list.value = value
  })
  return { list, refresh: result.refresh }
}
