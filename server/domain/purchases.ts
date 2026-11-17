import { and, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { purchases } from '../db/schema'
import { DomainError } from './errors'
import { wishOnList } from './placement'

/**
 * Sets how many of a wish this person is buying. An owner of the wish is treated like any buyer.
 *
 * The whole check runs in one synchronous transaction with no `await` in it, so two buyers who
 * click at the same moment are handled one after the other and can't both take the last one.
 *
 * Only an increase is checked. Lowering always works, also when the owner has since lowered
 * the amount or deleted the wish or the list.
 */
export function setPurchase(db: Db, token: string, wishId: number, userId: number, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) throw new DomainError('validation')

  db.transaction((tx) => {
    const { wish, list } = wishOnList(tx, token, wishId)
    const mine = tx.select().from(purchases)
      .where(and(eq(purchases.wishId, wishId), eq(purchases.userId, userId))).get()

    if (quantity > (mine?.quantity ?? 0)) {
      // Before anything about other purchases is read, so the answer is the same whether or
      // not anyone bought the wish: an owner can't use it to find out.
      if (wish.deletedAt || list.deletedAt) throw new DomainError('wish_removed')
      if (wish.quantity !== null) {
        const { others } = tx
          .select({ others: sql<number>`coalesce(sum(${purchases.quantity}), 0)` })
          .from(purchases)
          .where(and(eq(purchases.wishId, wishId), ne(purchases.userId, userId)))
          .get()!
        if (others + quantity > wish.quantity) throw new DomainError('quantity_exceeded')
      }
    }

    if (mine) tx.update(purchases).set({ quantity, updatedAt: new Date() }).where(eq(purchases.id, mine.id)).run()
    else tx.insert(purchases).values({ wishId, userId, quantity }).run()
  }, { behavior: 'immediate' })
}

/** Removing something that isn't there is not an error. */
export function removePurchase(db: Db, token: string, wishId: number, userId: number): void {
  db.transaction((tx) => {
    wishOnList(tx, token, wishId)
    tx.delete(purchases).where(and(eq(purchases.wishId, wishId), eq(purchases.userId, userId))).run()
  }, { behavior: 'immediate' })
}
