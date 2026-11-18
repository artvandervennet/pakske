import type { WishView } from '#shared/schemas/list'

/**
 * "I'm giving this", for one wish. A row has one of these, shared by its two controls: the box
 * or the count at the start of the folded row (WishTick) and the button or the stepper in the
 * opened card (WishGive). So both show the same number, the same refusal, and are busy together.
 *
 * A buyer can't take more than is left. An owner is never shown what is left: their controls
 * stay open, they are warned before every increase, and a refusal names nobody and gives no
 * number.
 *
 * `changed` runs after a change was saved or refused; 'gone' when the wish no longer exists,
 * so the page can say so if the row disappears.
 */
export function useWishTick(wish: () => WishView, token: () => string, changed: (reason?: 'gone') => void) {
  const { t } = useI18n()
  const { parse } = useApiError()
  const askWarning = useTickWarning()
  const { choiceFor } = useBuyAnonymously()

  const url = computed(() => `/api/lists/${token()}/wishes/${wish().id}/purchase`)
  const messageId = computed(() => `wish-${wish().id}-tick-message`)

  // What this person asked for last, until the refreshed list brings the real number. Without
  // it, a second tap before the refresh lands would send the same number again.
  const pending = ref<number | null>(null)
  const mine = computed(() => {
    const current = wish()
    return current.role === 'anon' ? 0 : pending.value ?? current.mine
  })
  /** Asked for once: a box, or a button that is pressed or not. Otherwise a number. */
  const once = computed(() => wish().quantity === 1)
  // The most this person can have: for a buyer their own plus what is left (tickCeiling). Null
  // for an unlimited wish.
  const ceiling = computed(() => tickCeiling(wish()))

  const message = ref('')
  // The tick state a refusal is about. A refusal asks for a refresh, and that refresh brings the
  // state it refers to (null until then); the message goes once a later refresh changes it.
  let messageState: string | null = null
  watch(wish, (current) => {
    pending.value = null
    if (!message.value) return
    const state = tickState(current)
    if (messageState === null) messageState = state
    else if (state !== messageState) message.value = ''
  })

  // Until the page is hydrated a tap does nothing, and a box would tick itself without asking,
  // so the box is really disabled until then.
  const hydrated = ref(false)
  onMounted(() => {
    hydrated.value = true
  })

  const busy = ref(false)
  const blocked = computed(() => !hydrated.value || busy.value)
  const canLower = computed(() => mine.value > 0)
  const raisable = computed(() => canRaise(wish(), mine.value))
  /** Nothing to do here now: none of their own to take back, and none left to take. */
  const unavailable = computed(() => !canLower.value && !raisable.value)

  async function setMine(target: number) {
    if (blocked.value) return
    if (target > mine.value && !raisable.value) return
    if (target < mine.value && !canLower.value) return
    const current = wish()
    // Busy before the warning, so a second tap can't open it again behind the first.
    busy.value = true
    message.value = ''
    try {
      if (needsWarning(current, mine.value, target) && !(await askWarning(current.title))) return
      if (target === 0) await $fetch(url.value, { method: 'DELETE' })
      // Giving without a name goes along only when the person chose it with this wish's own
      // switch; otherwise the server applies the account's setting (tickBody).
      else await $fetch(url.value, { method: 'PUT', body: tickBody(current, target, choiceFor(current.id)) })
      pending.value = target
      changed()
    }
    catch (error) {
      const { code, message: sentence } = parse(error)
      const refusal = tickRefusal(code, once.value)
      if (refusal) {
        message.value = t(refusal.key)
        messageState = null
        // A buyer who bought a removed wish keeps its row; for everyone else it goes.
        changed(refusal.gone ? 'gone' : undefined)
      }
      else {
        message.value = sentence
        messageState = tickState(wish())
      }
    }
    finally {
      busy.value = false
    }
  }

  /** One more, for the count at the start of a row and the stepper's +. */
  const more = () => setMine(mine.value + 1)
  /** One fewer, for the stepper's −. */
  const less = () => setMine(mine.value - 1)
  /** Give it or take that back, for a wish asked for once. */
  const flip = () => setMine(mine.value > 0 ? 0 : 1)

  /** The number in words, for screen readers: "Je geeft er 2 van 3". An owner has, a buyer gives. */
  const countWords = computed(() => {
    const own = wish().role === 'owner'
    if (ceiling.value === null) return t(own ? 'tick.ownCount' : 'tick.count', { n: mine.value })
    return t(own ? 'tick.ownCountOf' : 'tick.countOf', { n: mine.value, quantity: ceiling.value })
  })

  // The id of the refusal while there is one, for the controls' aria-describedby.
  const describedBy = computed(() => (message.value ? messageId.value : undefined))

  // One object whose fields read as plain values, so a component can take it as a prop.
  return reactive({ mine, once, ceiling, hydrated, blocked, canLower, raisable, unavailable, message, messageId, describedBy, countWords, more, less, flip })
}

export type WishTickState = ReturnType<typeof useWishTick>
