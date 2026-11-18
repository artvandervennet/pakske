import type { WishView } from '#shared/schemas/list'

/** What the page can ask of an open row (WishRow exposes it). */
export interface RowControl {
  /** Waits for the row's saves; false, with the focus on the field, when one failed. */
  settle: () => Promise<boolean>
}

/**
 * An owner's edit mode on their list: choose wishes to delete or share, and move them. Starting
 * it folds the open rows, the way folding them by hand does: it waits for their saves, and a row
 * holding a failed save stays open and keeps edit mode from starting. It also runs on a list
 * without wishes, where the page still offers to delete the list, and stays on when the last
 * wish is deleted.
 * `order` is the order the page shows while editing. A move shows at once and is saved whole; a
 * save that fails says so and puts the list back in the server's order.
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

  const editing = ref(false)
  const selected = reactive(new Set<number>())
  const error = ref('')
  // A failed order save, said in the bar and also above the list when edit mode has ended.
  const orderError = ref('')
  const busy = ref(false)

  // The order on screen follows the server's, except while a move is waiting to be saved.
  const order = ref<number[]>([])
  const ids = () => options.wishes().map(wish => wish.id)
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let saving: Promise<void> = Promise.resolve()
  const unsaved = ref(0)
  watch(() => ids().join(), () => {
    if (!unsaved.value) order.value = ids()
  }, { immediate: true })

  /** Moves a wish to place `to` (0 is the top) in the order on screen. */
  function move(id: number, to: number) {
    const next = order.value.filter(other => other !== id)
    next.splice(Math.max(0, Math.min(to, next.length)), 0, id)
    order.value = next
  }

  /** Saves the order on screen, now or after `delay` ms without another call. */
  function saveOrder(saveOptions: { delay?: number } = {}) {
    if (saveTimer === undefined) unsaved.value++
    clearTimeout(saveTimer)
    saveTimer = setTimeout(sendOrder, saveOptions.delay ?? 0)
  }

  /** Sends a save that is still waiting for its delay, such as when edit mode ends. */
  function flushOrder() {
    if (saveTimer === undefined) return
    clearTimeout(saveTimer)
    sendOrder()
  }

  function sendOrder() {
    saveTimer = undefined
    const wishIds = [...order.value]
    // One save at a time, in the order they were made: each sends the whole order.
    saving = saving.then(async () => {
      try {
        if (wishIds.length) await $fetch<unknown>(`/api/lists/${options.token()}/order`, { method: 'PUT', body: { wishIds } })
        orderError.value = ''
      }
      catch {
        orderError.value = t('listEdit.orderFailed')
      }
      finally {
        unsaved.value--
        if (!unsaved.value) {
          await options.refresh()
          // A move made while the list was refreshing is still waiting to be saved: keep it.
          if (!unsaved.value) order.value = ids()
        }
      }
    })
  }

  /** The chosen wishes that are still on the list: one may have gone since it was chosen. */
  const chosen = () => options.wishes().filter(wish => selected.has(wish.id))

  async function enter(wishId?: number): Promise<boolean> {
    // A field in an open row that still has the focus, as when a finger holds another row, is
    // left first, so what was typed in it is saved rather than folded away.
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('.wish-row.open')) {
      active.blur()
      await nextTick()
    }
    for (const id of [...options.open]) {
      const row = options.rows.get(id)
      if (row && !(await row.settle())) return false
    }
    options.open.clear()
    if (!editing.value) {
      selected.clear()
      error.value = ''
      orderError.value = ''
    }
    editing.value = true
    if (wishId !== undefined) selected.add(wishId)
    return true
  }

  function leave() {
    flushOrder()
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
      error.value = parse(failure).message
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

  /** True while a move waits to be saved: the page keeps showing `order` until then. */
  const orderPending = computed(() => unsaved.value > 0)

  return { editing, selected, error, orderError, busy, chosen, enter, leave, toggle, deleteSelected, order, orderPending, move, saveOrder }
}

export type ListEdit = ReturnType<typeof useListEdit>
