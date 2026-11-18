// "Weghalen" on a visited list, for the home page and the lists page. It only takes the list
// off the person's visited lists (in the account, or in the cookie when logged out); the link
// keeps working.
//
// `refresh` loads the page's lists again. The button that had the focus is gone with its row,
// so afterwards the focus goes to the element `after` names: a heading or a tab that is still
// there.
export function useForgetList(refresh: () => Promise<unknown>, after: () => HTMLElement | null | undefined) {
  const { parse } = useApiError()
  const removing = ref<string | null>(null)
  const removeError = ref('')

  async function forget(token: string) {
    if (removing.value) return
    removing.value = token
    removeError.value = ''
    try {
      await $fetch(`/api/home/opened/${token}`, { method: 'DELETE' })
      await refresh()
      await nextTick()
      after()?.focus()
    }
    catch (error) {
      removeError.value = parse(error).message
    }
    finally {
      removing.value = null
    }
  }

  return { removeError, forget }
}
