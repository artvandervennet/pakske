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
 * The line under a wish's title. For a buyer, who bought it; how many are left is in the
 * stepper (`tickCeiling`). For an owner who bought it themselves, that they did, and never how
 * many are left: that would tell them what others bought. Otherwise the start of the text, or
 * the shop's name from the first link when there is no text.
 */
export function wishLine(wish: WishView, t: Translate): string {
  if (wish.role === 'owner' && wish.mine > 0) return t('wish.yours', wish.mine)
  if (wish.role === 'buyer' && wish.purchases.length > 0) return buyers(wish, t)
  const text = wish.description?.replace(/\s+/g, ' ').trim()
  // The row cuts the line off with an ellipsis; this only keeps the payload small.
  return text ? text.slice(0, 160) : (hostOf(wish.urls[0]) ?? '')
}

/** "Jij geeft er 2 · Moeke geeft er 1 · Iemand anders geeft er 1", or "Moeke geeft dit" for a wish asked for once. */
function buyers(wish: BuyerWish, t: Translate): string {
  const parts = wish.purchases.map((purchase) => {
    // With one asked for, a number after every name says nothing.
    const once = wish.quantity === 1
    if (purchase.mine) return once ? t('purchase.youGiveThis', {}) : t('purchase.youGive', { n: purchase.quantity })
    if (purchase.name === null) return once ? t('purchase.someoneGivesThis', {}) : t('purchase.someoneGives', { n: purchase.quantity })
    return once ? t('purchase.givesThis', { name: purchase.name }) : t('purchase.gives', { name: purchase.name, n: purchase.quantity })
  })
  return parts.join(' · ')
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
