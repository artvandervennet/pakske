// "Weghalen" on a list a friend shows you, for the home page and the lists page. It only takes
// the list off your own page; the friend's choice stays as it is and they aren't told.
//
// `refresh` loads the page's lists again. The button that had the focus is gone with its row,
// so afterwards the focus goes to the element `after` names.
export function useHideShown(refresh: () => Promise<unknown>, after: () => HTMLElement | null | undefined) {
  const { parse } = useApiError()
  const hiding = ref<string | null>(null)
  const hideError = ref('')

  async function hide(token: string) {
    if (hiding.value) return
    hiding.value = token
    hideError.value = ''
    try {
      await $fetch<unknown>(`/api/friends/shown/${token}`, { method: 'DELETE' })
      await refresh()
      await nextTick()
      after()?.focus()
    }
    catch (error) {
      hideError.value = parse(error).message
    }
    finally {
      hiding.value = null
    }
  }

  return { hideError, hide }
}
