import type { BuyerItem, PublicItem } from '#shared/schemas/list'

// The words on a wish: how many are asked for, and for buyers how many are bought.
export function useItemStatus() {
  const { t } = useI18n()

  /** "3 gevraagd", "Onbeperkt", or nothing for a single one. */
  function amountLabel(item: PublicItem): string | null {
    if (item.quantity === null) return t('item.unlimited')
    return item.quantity > 1 ? t('item.wanted', { n: item.quantity }) : null
  }

  /** "2 van 3 gekocht" and its variants. Only buyers have the numbers for this. */
  function boughtLabel(item: BuyerItem): string {
    const { bought, quantity: wanted } = item
    if (bought === 0) return t('item.notBought')
    if (wanted === null) return t('item.countBought', { bought })
    if (bought > wanted) return t('item.overBought', { bought, wanted })
    if (bought === wanted) return wanted === 1 ? t('item.bought') : t('item.allBought', { wanted })
    return t('item.someBought', { bought, wanted })
  }

  return { amountLabel, boughtLabel }
}

export function isBuyerItem(item: PublicItem | BuyerItem): item is BuyerItem {
  return 'purchases' in item
}
