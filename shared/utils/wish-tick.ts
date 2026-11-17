import type { WishView } from '../schemas/list'

// What the tick at the start of a row may do. WishTick.vue asks these and does the rest.

/**
 * May this person tick one more, now that they have `mine`? `mine` can be ahead of the wish's
 * own number while the list catches up with what they just asked for. An owner always may:
 * holding them back would tell them that the others took everything.
 */
export function canRaise(wish: WishView, mine: number): boolean {
  if (wish.role === 'anon') return false
  if (wish.role === 'owner') return true
  if (wish.removed) return false
  if (wish.quantity === null) return true
  return wish.bought + (mine - wish.mine) < wish.quantity
}

/** Does going from `from` to `to` need the owner's warning first? Only an owner's increase. */
export function needsWarning(wish: WishView, from: number, to: number): boolean {
  return wish.role === 'owner' && to > from
}

/**
 * The words for a refused tick, and whether the wish itself is gone or off the list. Only the
 * code and whether the wish is wanted once count, so an owner's refusal reads like anyone's:
 * no names and no numbers. null for any other error, which has a sentence of its own.
 */
export function tickRefusal(code: string, wantedOnce: boolean): { key: string, gone: boolean } | null {
  if (code === 'quantity_exceeded') return { key: wantedOnce ? 'tick.taken' : 'tick.notEnough', gone: false }
  if (code === 'wish_removed') return { key: 'tick.removed', gone: true }
  if (code === 'not_found') return { key: 'tick.gone', gone: true }
  return null
}

/**
 * The numbers that decide what a tick can do, as one string to compare. A refusal stays under
 * its row until these change.
 */
export function tickState(wish: WishView): string {
  if (wish.role === 'buyer') return [wish.quantity, wish.bought, wish.mine, wish.removed].join('/')
  if (wish.role === 'owner') return [wish.quantity, wish.mine].join('/')
  return String(wish.quantity)
}
