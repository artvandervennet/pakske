import type { ListResponse } from '#shared/schemas/list'

/**
 * A wishlist, as the server lets this person see it. The server decides what is in the
 * response, so the page (and the data Nuxt writes into the HTML) can't hold anything the
 * person shouldn't see. An unknown list is a 404 page.
 */
export async function useList(username: MaybeRefOrGetter<string>) {
  const route = useRoute()
  // One cache entry per page. Pages that share an entry also share its age: going from a wish
  // back to the list after a change would show the list as it was before.
  const key = `list:${toValue(username)}:${route.path}`
  const result = await useFetch<ListResponse>(() => `/api/lists/${encodeURIComponent(toValue(username))}`, { key })
  if (result.error.value || !result.data.value) {
    throw createError({ statusCode: result.error.value?.statusCode ?? 404, fatal: true })
  }
  // A refresh that fails (the connection dropped, the server is restarting) clears the data.
  // The page keeps the last list it got.
  const list = shallowRef(result.data.value) as Ref<ListResponse>
  watch(result.data, (value) => {
    if (value) list.value = value
  })
  return { list, refresh: result.refresh }
}
