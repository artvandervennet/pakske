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

/**
 * The number after the slash in the stepper, or null for an unlimited wish. A buyer sees the most
 * they can have: their own plus what is left, so "0 / 2" when two of four are taken; a removed
 * wish leaves them only what they have. An owner sees what was asked for, never what is left.
 */
export function tickCeiling(wish: WishView): number | null {
  if (wish.quantity === null) return null
  if (wish.role !== 'buyer') return wish.quantity
  if (wish.removed) return wish.mine
  return Math.max(wish.mine, wish.quantity - (wish.bought - wish.mine))
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
