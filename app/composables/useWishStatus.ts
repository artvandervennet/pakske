import type { WishView } from '#shared/schemas/list'

// The words on a row: the line under the title and the amount tag. The rules are in
// shared/utils/wish-line.ts, where they can be tested without Nuxt.
export function useWishStatus() {
  const { t } = useI18n()
  return {
    lineParts: (wish: WishView) => wishLineParts(wish, t),
    amountTag: (wish: WishView) => wishAmountTag(wish, t),
  }
}
