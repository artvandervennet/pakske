import { and, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { purchases, users } from '../db/schema'
import { DomainError } from './errors'
import { wishOnList } from './placement'

/**
 * Sets how many of a wish this person is buying. An owner of the wish is treated like any buyer.
 *
 * The whole check runs in one synchronous transaction with no `await` in it, so two buyers who
 * click at the same moment are handled one after the other and can't both take the last one.
 *
 * Only an increase is checked. Lowering always works, also when the owner has since lowered
 * the amount, taken the wish off this list, or deleted the wish or the list. It also works
 * through an address the list had before a new link, but only for someone who has a purchase
 * on the wish: for anyone else that address is "not found", like one that never existed.
 *
 * `anonymous` says whether the other buyers see "someone" instead of this person's name. Left
 * out, a purchase keeps what it had, and a new one goes by what the buyer chose in Settings
 * ("Standaard anoniem geven"): with the name, unless they turned that on.
 */
export function setPurchase(db: Db, token: string, wishId: number, userId: number, quantity: number, anonymous?: boolean): void {
  if (!Number.isInteger(quantity) || quantity < 1) throw new DomainError('validation')

  db.transaction((tx) => {
    const { wish, live, old } = wishOnList(tx, token, wishId, { old: true })
    const mine = tx.select().from(purchases)
      .where(and(eq(purchases.wishId, wishId), eq(purchases.userId, userId))).get()
    // Decided by the person's own row alone, so it says nothing about anyone else.
    if (old && !mine) throw new DomainError('not_found')

    if (quantity > (mine?.quantity ?? 0)) {
      // Before anything about other purchases is read, so the answer is the same whether or
      // not anyone bought the wish: an owner can't use it to find out.
      if (!live) throw new DomainError('wish_removed')
      if (wish.quantity !== null) {
        const { others } = tx
          .select({ others: sql<number>`coalesce(sum(${purchases.quantity}), 0)` })
          .from(purchases)
          .where(and(eq(purchases.wishId, wishId), ne(purchases.userId, userId)))
          .get()!
        if (others + quantity > wish.quantity) throw new DomainError('quantity_exceeded')
      }
    }

    if (mine) {
      tx.update(purchases).set({ quantity, anonymous: anonymous ?? mine.anonymous, updatedAt: new Date() }).where(eq(purchases.id, mine.id)).run()
      return
    }
    const buyer = tx.select({ anonymousDefault: users.anonymousDefault }).from(users).where(eq(users.id, userId)).get()
    tx.insert(purchases).values({ wishId, userId, quantity, anonymous: anonymous ?? buyer?.anonymousDefault ?? false }).run()
  }, { behavior: 'immediate' })
}

/** Removing something that isn't there is not an error. */
export function removePurchase(db: Db, token: string, wishId: number, userId: number): void {
  db.transaction((tx) => {
    wishOnList(tx, token, wishId, { old: true })
    tx.delete(purchases).where(and(eq(purchases.wishId, wishId), eq(purchases.userId, userId))).run()
  }, { behavior: 'immediate' })
}
