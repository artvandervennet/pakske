// Making a list from the + row under your own lists, on the home page and the lists page. A new
// list opens at once, so its first wish can be typed there. `creating` and `createError` are
// what <QuickAdd> wants as `pending` and `error`.
export function useNewList() {
  const localePath = useLocalePath()
  const { parse } = useApiError()
  const creating = ref(false)
  const createError = ref('')

  async function createList(title: string) {
    creating.value = true
    createError.value = ''
    try {
      const list = await $fetch<{ token: string }>('/api/lists', { method: 'POST', body: { title } })
      await navigateTo(localePath(`/l/${list.token}`))
    }
    catch (error) {
      const parsed = parse(error)
      createError.value = parsed.fields.title ?? parsed.message
    }
    finally {
      creating.value = false
    }
  }

  return { creating, createError, createList }
}
