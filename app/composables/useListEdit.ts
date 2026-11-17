import type { WishView } from '#shared/schemas/list'

/** What the page can ask of an open row (WishRow exposes it). */
export interface RowControl {
  /** Waits for the row's saves; false, with the focus on the field, when one failed. */
  settle: () => Promise<boolean>
}

/**
 * An owner's edit mode on their list: choose wishes to delete or make joint. Starting it folds the
 * open rows, the way folding them by hand does: it waits for their saves, and a row holding a
 * failed save stays open and keeps edit mode from starting.
 */
export function useListEdit(options: {
  token: () => string
  wishes: () => WishView[]
  refresh: () => Promise<unknown>
  open: Set<number>
  rows: Map<number, RowControl>
}) {
  const { t } = useI18n()
  const { parse } = useApiError()
  const localePath = useLocalePath()

  const editing = ref(false)
  const selected = reactive(new Set<number>())
  const error = ref('')
  const busy = ref(false)

  /** The chosen wishes that are still on the list: one may have gone since it was chosen. */
  const chosen = () => options.wishes().filter(wish => selected.has(wish.id))

  async function enter(wishId?: number): Promise<boolean> {
    for (const id of [...options.open]) {
      const row = options.rows.get(id)
      if (row && !(await row.settle())) return false
    }
    options.open.clear()
    if (!editing.value) {
      selected.clear()
      error.value = ''
    }
    editing.value = true
    if (wishId !== undefined) selected.add(wishId)
    return true
  }

  function leave() {
    editing.value = false
    selected.clear()
    error.value = ''
  }

  function toggle(id: number, on: boolean) {
    if (on) selected.add(id)
    else selected.delete(id)
    error.value = ''
  }

  async function run(request: () => Promise<unknown>): Promise<boolean> {
    busy.value = true
    error.value = ''
    try {
      await request()
      return true
    }
    catch (failure) {
      const parsed = parse(failure)
      error.value = parsed.fields.wishIds ? t('joint.tooMany') : parsed.message
      await options.refresh()
      return false
    }
    finally {
      busy.value = false
    }
  }

  /** Deletes the chosen wishes, each the way a single delete goes. Edit mode stays on. */
  async function deleteSelected(): Promise<void> {
    const wishIds = chosen().map(wish => wish.id)
    if (busy.value || !wishIds.length) return
    const done = await run(() => $fetch<unknown>(`/api/lists/${options.token()}/wishes/delete`, { method: 'POST', body: { wishIds } }))
    if (!done) return
    selected.clear()
    await options.refresh()
  }

  /** The one-time link for the chosen wishes, as a path; edit mode ends when it is made. */
  async function makeLink(): Promise<string | null> {
    const wishIds = chosen().map(wish => wish.id)
    if (busy.value || !wishIds.length) return null
    let path: string | null = null
    const done = await run(async () => {
      const made = await $fetch<{ invite: string }>(`/api/lists/${options.token()}/invites`, { method: 'POST', body: { kind: 'wishes', wishIds } })
      path = localePath(`/j/${made.invite}`)
    })
    if (done) leave()
    return path
  }

  // Nothing left to edit: edit mode ends by itself.
  watch(() => options.wishes().length, (count) => {
    if (!count && editing.value) leave()
  })

  return { editing, selected, error, busy, chosen, enter, leave, toggle, deleteSelected, makeLink }
}

export type ListEdit = ReturnType<typeof useListEdit>
