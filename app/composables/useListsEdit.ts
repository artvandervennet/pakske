/**
 * Edit mode on the lists page: tick lists, then delete your own or take other people's off the
 * page. A list is known here by its token, which no two lists share.
 *
 * `each` does one request per list, one after the other, with the requests a single list
 * already has. It stops at the first that fails and says why; the lists before it are done, and
 * the ones from there on stay ticked. A list that is gone already (another tab, another owner)
 * counts as done. Afterwards the page's lists are loaded again. Edit mode stays on.
 */
export function useListsEdit(options: { refresh: () => Promise<unknown> }) {
  const { parse } = useApiError()

  const editing = ref(false)
  const selected = reactive(new Set<string>())
  const error = ref('')
  const busy = ref(false)

  function enter() {
    selected.clear()
    error.value = ''
    editing.value = true
  }

  function leave() {
    editing.value = false
    selected.clear()
    error.value = ''
  }

  function toggle(token: string, on: boolean) {
    if (on) selected.add(token)
    else selected.delete(token)
    error.value = ''
  }

  /** Unticks everything, as when the page shows other lists than the ticked ones. */
  function clear() {
    selected.clear()
    error.value = ''
  }

  async function each(tokens: string[], request: (token: string) => Promise<unknown>): Promise<void> {
    if (busy.value || !tokens.length) return
    busy.value = true
    error.value = ''
    try {
      for (const token of tokens) {
        try {
          await request(token)
        }
        catch (failure) {
          const parsed = parse(failure)
          if (parsed.code !== 'not_found') {
            error.value = parsed.message
            break
          }
        }
        selected.delete(token)
      }
    }
    finally {
      await options.refresh()
      busy.value = false
    }
  }

  return { editing, selected, error, busy, enter, leave, toggle, clear, each }
}
