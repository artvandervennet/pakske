import type { WishView } from '#shared/schemas/list'

/**
 * Whether this person gives a wish without their name: the other buyers then see "Iemand".
 * Once they have a purchase, the server keeps the choice. Before that, and after taking a
 * purchase back, the page remembers it per wish, so the tick that follows sends it along.
 */
export function useBuyAnonymously() {
  const chosen = useState<Record<number, boolean>>('buy-anonymously', () => ({}))

  function isAnonymous(wish: WishView): boolean {
    if (wish.role === 'buyer') {
      const mine = wish.purchases.find(purchase => purchase.mine)
      if (mine) return mine.anonymous
    }
    return chosen.value[wish.id] ?? false
  }

  function choose(wishId: number, anonymous: boolean) {
    chosen.value = { ...chosen.value, [wishId]: anonymous }
  }

  return { isAnonymous, choose }
}
