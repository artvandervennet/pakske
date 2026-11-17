import { and, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { items, purchases } from '../db/schema'
import { DomainError } from './errors'

/**
 * Sets how many of a wish this buyer is buying.
 *
 * The whole check runs in one synchronous transaction with no `await` in it, so two buyers who
 * click at the same moment are handled one after the other and can't both take the last one.
 *
 * Only an increase is checked against the amount asked for. Lowering always works, also when
 * the owner has since lowered the amount or taken the wish off the list.
 */
export function setPurchase(db: Db, itemId: number, buyerId: number, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) throw new DomainError('validation')

  db.transaction((tx) => {
    const item = tx.select().from(items).where(eq(items.id, itemId)).get()
    if (!item) throw new DomainError('not_found')
    // Before anything about purchases is read: the owner gets the same answer in every state.
    if (item.userId === buyerId) throw new DomainError('forbidden')

    const mine = tx.select().from(purchases)
      .where(and(eq(purchases.itemId, itemId), eq(purchases.userId, buyerId))).get()

    if (quantity > (mine?.quantity ?? 0)) {
      if (item.deletedAt) throw new DomainError('item_removed')
      if (item.quantity !== null) {
        const { others } = tx
          .select({ others: sql<number>`coalesce(sum(${purchases.quantity}), 0)` })
          .from(purchases)
          .where(and(eq(purchases.itemId, itemId), ne(purchases.userId, buyerId)))
          .get()!
        if (others + quantity > item.quantity) throw new DomainError('quantity_exceeded')
      }
    }

    if (mine) tx.update(purchases).set({ quantity, updatedAt: new Date() }).where(eq(purchases.id, mine.id)).run()
    else tx.insert(purchases).values({ itemId, userId: buyerId, quantity }).run()
  }, { behavior: 'immediate' })
}

export function removePurchase(db: Db, itemId: number, buyerId: number): void {
  db.transaction((tx) => {
    const item = tx.select({ userId: items.userId }).from(items).where(eq(items.id, itemId)).get()
    if (!item) throw new DomainError('not_found')
    if (item.userId === buyerId) throw new DomainError('forbidden')
    tx.delete(purchases).where(and(eq(purchases.itemId, itemId), eq(purchases.userId, buyerId))).run()
  }, { behavior: 'immediate' })
}
