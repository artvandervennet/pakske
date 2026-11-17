import type { BuyerWish, WishView } from '#shared/schemas/list'

/** The shop's name from a link, without "www.", or null when the link doesn't parse. */
export function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host.replace(/^www\./, '')
  }
  catch {
    return null
  }
}

// The words on a row: the line under the title and the amount tag.
export function useWishStatus() {
  const { t } = useI18n()

  /**
   * For a buyer, who bought it and how many are left. For an owner who bought it themselves,
   * that they did, and never how many are left: that would tell them what others bought.
   * Otherwise the start of the text, or the shop's name when there is no text.
   */
  function secondLine(wish: WishView): string {
    if (wish.role === 'owner' && wish.mine > 0) return t('wish.yours', wish.mine)
    if (wish.role === 'buyer' && wish.purchases.length > 0) return buyers(wish)
    const text = wish.description?.replace(/\s+/g, ' ').trim()
    // The row cuts the line off with an ellipsis; this only keeps the payload small.
    return text ? text.slice(0, 160) : (hostOf(wish.url) ?? '')
  }

  /** "Jij 2 · Moeke 1 · niets meer over". */
  function buyers(wish: BuyerWish): string {
    const parts = wish.purchases.map((purchase) => {
      const name = purchase.mine ? t('purchase.you') : purchase.name
      // With one asked for, a number after every name says nothing.
      return wish.quantity === 1 ? name : `${name} ${purchase.quantity}`
    })
    // A removed wish has nothing left to buy; saying "1 left" would invite someone to.
    if (wish.quantity !== null && !wish.removed) {
      const left = Math.max(0, wish.quantity - wish.bought)
      parts.push(t('wish.left', left))
    }
    return parts.join(' · ')
  }

  /** "3 gevraagd", "Onbeperkt", or null for a single one. */
  function amountTag(wish: WishView): string | null {
    if (wish.quantity === null) return t('item.unlimited')
    return wish.quantity > 1 ? t('item.wanted', { n: wish.quantity }) : null
  }

  return { secondLine, amountTag }
}
