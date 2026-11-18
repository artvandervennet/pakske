import type { WishView } from '#shared/schemas/list'

/**
 * Whether this person gives a wish without their name: the other buyers then see "Iemand anders".
 *
 * Only what they chose themselves with a wish's "Anoniem geven" switch is kept here, per wish,
 * and only that goes along with a tick (`tickBody` in shared/utils/wish-tick.ts). A plain tick
 * records nothing and sends nothing about it: the server keeps a purchase as it is and gives a
 * new one the account's "Standaard anoniem geven". So a setting changed in Settings, in this tab
 * or on another device, counts for the next tick, and no stale copy of it here can win.
 *
 * The switch shows the choice, else what the purchase has, else the setting as this session
 * knows it (`anonymousShown`).
 */
export function useBuyAnonymously() {
  const chosen = useState<Record<number, boolean>>('buy-anonymously', () => ({}))
  const { user } = useUserSession()

  /** What the person chose for this wish with its switch; undefined when they never used it. */
  const choiceFor = (wishId: number): boolean | undefined => chosen.value[wishId]

  /** What the switch shows for this wish. */
  const isAnonymous = (wish: WishView): boolean =>
    anonymousShown(wish, choiceFor(wish.id), user.value?.anonymousDefault ?? false)

  /** Keeps the choice the person made with the switch; undefined forgets it again. */
  function choose(wishId: number, anonymous: boolean | undefined) {
    const next = { ...chosen.value }
    if (anonymous === undefined) delete next[wishId]
    else next[wishId] = anonymous
    chosen.value = next
  }

  return { isAnonymous, choiceFor, choose }
}
