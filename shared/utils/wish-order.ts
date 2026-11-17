import type { WishView } from '../schemas/list'

/**
 * The rows of a list in the order the page shows them. Removed wishes only reach buyers, who
 * still need them to sort out what they bought. They go last, below everything that is still
 * wanted; within each group the order stays as the server sent it.
 */
export function removedLast(wishes: WishView[]): WishView[] {
  const isRemoved = (wish: WishView) => wish.role === 'buyer' && wish.removed
  return [...wishes.filter(wish => !isRemoved(wish)), ...wishes.filter(isRemoved)]
}
