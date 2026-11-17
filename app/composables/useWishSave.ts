import type { OwnerWish, PublicWish } from '#shared/schemas/list'
import type { WishChange } from '#shared/utils/wish-edit'

/**
 * Saving for an owner's row, where every field saves by itself. One per row, shared by the
 * title in the row's head and the fields under it, so the row has one "Saved" line and knows
 * whether anything is still on its way.
 *
 * `run` does a request and answers null when it worked, or the sentence to show beside the
 * field when it didn't; it never throws, so a field keeps what was typed.
 */
export function useWishSave(wish: () => OwnerWish, token: () => string, onChanged: () => void) {
  const { parse } = useApiError()
  const url = (): string => `/api/lists/${token()}/wishes/${wish().id}`

  const inFlight = ref(0)
  const saved = ref(false)
  let savedTimer: ReturnType<typeof setTimeout> | undefined
  // What waits for the saves on their way, such as folding the row (see `whenSaved`).
  let afterSaves: (() => void) | null = null

  async function run(request: () => Promise<unknown>, field?: string): Promise<string | null> {
    inFlight.value++
    saved.value = false
    try {
      await request()
      saved.value = true
      clearTimeout(savedTimer)
      savedTimer = setTimeout(() => (saved.value = false), 2500)
      onChanged()
      return null
    }
    catch (error) {
      // A failed save keeps the row open, with the reason beside what was typed.
      afterSaves = null
      const parsed = parse(error)
      return (field && parsed.fields[field]) || parsed.message
    }
    finally {
      inFlight.value--
      if (!inFlight.value && afterSaves) {
        const next = afterSaves
        afterSaves = null
        next()
      }
    }
  }

  /** Sends one field. A change that changes nothing sends nothing. */
  function save(change: WishChange | null): Promise<string | null> {
    if (!change) return Promise.resolve(null)
    const [field] = Object.keys(change)
    return run(() => $fetch<PublicWish>(url(), { method: 'PATCH', body: change }), field)
  }

  /** Runs `next` once every save on its way worked; drops it when one fails. */
  function whenSaved(next: () => void) {
    if (inFlight.value) afterSaves = next
    else next()
  }

  onBeforeUnmount(() => clearTimeout(savedTimer))

  return { url, run, save, whenSaved, saved: readonly(saved), busy: computed(() => inFlight.value > 0) }
}

export type WishSave = ReturnType<typeof useWishSave>
