import type { BuyerWish, WishView } from '../schemas/list'

/** vue-i18n's `t`, narrowed to the ways the rows' and notices' words call it. */
export interface Translate {
  (key: string, plural: number): string
  (key: string, named: Record<string, unknown>): string
  (key: string, named: Record<string, unknown>, plural: number): string
}

/** The shop's name from a link, without "www.", or null when the link doesn't parse. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host.replace(/^www\./, '')
  }
  catch {
    return null
  }
}

/**
 * What each link of a wish is called: its shop's name. When several lead to one shop, the later
 * ones get a number ("bol.com", "bol.com (2)"), so no two links or their buttons read the same.
 */
export function linkNames(urls: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return urls.map((url) => {
    const name = hostOf(url) ?? url
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    return count === 1 ? name : `${name} (${count})`
  })
}

/**
 * The line under a wish's title, in two parts. `mine` is what a buyer gives themselves ("Jij
 * geeft dit"), which the row shows as a tape of its own; it is null for everyone else. `rest`
 * is, for a buyer, who else gives; how many are left is in the stepper (`tickCeiling`). For an
 * owner who has it themselves, that they do, and never how many are left: that would tell them
 * what others bought. Otherwise the start of the text, or the shop's name from the first link
 * when there is no text.
 */
export function wishLineParts(wish: WishView, t: Translate): { mine: string | null, rest: string } {
  if (wish.role === 'owner' && wish.mine > 0) return { mine: null, rest: t('wish.yours', wish.mine) }
  if (wish.role === 'buyer' && wish.purchases.length > 0) {
    const own = wish.purchases.find(purchase => purchase.mine)
    return {
      mine: own ? givingWords(wish, own, t) : null,
      rest: wish.purchases.filter(purchase => !purchase.mine).map(purchase => givingWords(wish, purchase, t)).join(' · '),
    }
  }
  const text = wish.description?.replace(/\s+/g, ' ').trim()
  // The row cuts the line off with an ellipsis; this only keeps the payload small.
  return { mine: null, rest: text ? text.slice(0, 160) : (hostOf(wish.urls[0]) ?? '') }
}

/** The same line as one sentence, your own part first: "Jij geeft er 2 · Moeke geeft er 1". */
export function wishLine(wish: WishView, t: Translate): string {
  const { mine, rest } = wishLineParts(wish, t)
  return [mine, rest].filter(Boolean).join(' · ')
}

/** "Jij geeft er 2", "Moeke geeft er 1", "Iemand anders geeft er 1"; "Moeke geeft dit" for a wish asked for once. */
function givingWords(wish: BuyerWish, purchase: BuyerWish['purchases'][number], t: Translate): string {
  // With one asked for, a number after every name says nothing.
  const once = wish.quantity === 1
  if (purchase.mine) return once ? t('purchase.youGiveThis', {}) : t('purchase.youGive', { n: purchase.quantity })
  if (purchase.name === null) return once ? t('purchase.someoneGivesThis', {}) : t('purchase.someoneGives', { n: purchase.quantity })
  return once ? t('purchase.givesThis', { name: purchase.name }) : t('purchase.gives', { name: purchase.name, n: purchase.quantity })
}

/**
 * The tag that says whose wish it is besides the list's owners: "met Lotte" when someone who
 * doesn't own this list owns it too, "ook van jou" for an owner of the wish looking at someone
 * else's list, or null. The names are owners only, so the tag is the same for every viewer of
 * a row whatever buyers did. A row taken off this list has its own tag and no other: the names
 * would be of people it went on living with elsewhere.
 */
export function wishOwnerTag(wish: WishView, viewerOwnsList: boolean):
  { key: 'wish.with', names: string[] } | { key: 'wish.alsoYours' } | null {
  if (wish.role === 'buyer' && wish.removed) return null
  if (wish.sharedWith.length > 0) return { key: 'wish.with', names: wish.sharedWith }
  if (wish.role === 'owner' && !viewerOwnsList) return { key: 'wish.alsoYours' }
  return null
}

/** "3 gevraagd", "Onbeperkt", or null for a single one. */
export function wishAmountTag(wish: WishView, t: Translate): string | null {
  if (wish.quantity === null) return t('wish.unlimited', {})
  return wish.quantity > 1 ? t('wish.wanted', { n: wish.quantity }) : null
}
