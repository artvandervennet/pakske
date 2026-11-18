import type { WishView } from '../schemas/list'

// What the tick at the start of a row may do, and how its row looks. useWishTick.ts and
// WishRow.vue ask these and do the rest.

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

/**
 * Is the wish checked off: nothing left to take? For a buyer, when everything asked
 * for is taken. An owner only by their own ticks: anything else would tell them what buyers did.
 * A wish taken off the list has its own tag instead, and an unlimited one is never done.
 */
export function isCheckedOff(wish: WishView): boolean {
  if (wish.quantity === null || wish.role === 'anon') return false
  if (wish.role === 'owner') return wish.mine >= wish.quantity
  return !wish.removed && wish.bought >= wish.quantity
}

/**
 * Does the viewer give this wish, or some of it? Only a buyer with a number of their own: an
 * owner's tick says they have it themselves, which is not giving. The row of a wish you give
 * is marked as yours (see `isCrossedOut`).
 */
export function givenByMe(wish: WishView): boolean {
  return wish.role === 'buyer' && wish.mine > 0
}

/**
 * Is the row greyed and its title crossed out? When it is checked off and the viewer gives none
 * of it: others took everything, or an owner ticked it all themselves. A row you give stays in
 * full colour even when the wish is fully taken, so what is yours to buy stands out from what
 * is settled.
 */
export function isCrossedOut(wish: WishView): boolean {
  return isCheckedOff(wish) && !givenByMe(wish)
}

/** Does going from `from` to `to` need the owner's warning first? Only an owner's increase. */
export function needsWarning(wish: WishView, from: number, to: number): boolean {
  return wish.role === 'owner' && to > from
}

/**
 * What a tick sends: the number, and whether to give without a name only when the person chose
 * that themselves with this wish's "Anoniem geven" switch (`chosen`). Without a choice the field
 * is left out. The server then keeps an existing purchase as it is and gives a new one the
 * account's "Standaard anoniem geven", which this page may not know yet: the setting can have
 * changed in another tab or on another device. An owner's own tick never sends it.
 */
export function tickBody(wish: WishView, quantity: number, chosen: boolean | undefined): { quantity: number, anonymous?: boolean } {
  if (wish.role !== 'buyer' || chosen === undefined) return { quantity }
  return { quantity, anonymous: chosen }
}

/**
 * What the "Anoniem geven" switch shows: what the person chose for this wish, else what their
 * purchase has, else the account's setting as this session knows it. After a tick the refreshed
 * list brings the purchase, so the switch follows what the server stored.
 */
export function anonymousShown(wish: WishView, chosen: boolean | undefined, accountDefault: boolean): boolean {
  if (wish.role !== 'buyer') return false
  if (chosen !== undefined) return chosen
  return wish.purchases.find(purchase => purchase.mine)?.anonymous ?? accountDefault
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
