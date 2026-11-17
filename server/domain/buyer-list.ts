import { asc, eq, inArray } from 'drizzle-orm'
import type { BuyerItem } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { items, notes, purchases, users } from '../db/schema'
import { toPublicItem } from './public-list'

/**
 * A list as a logged-in visitor who is not its owner sees it: every wish with who bought how
 * many and the notes, plus the wishes the owner deleted after someone bought them.
 *
 * Never call this for the owner or for a visitor who isn't logged in. `getList` decides.
 */
export function listBuyerItems(db: Db, ownerId: number, viewerId: number): BuyerItem[] {
  const rows = db.select().from(items).where(eq(items.userId, ownerId)).orderBy(asc(items.createdAt), asc(items.id)).all()
  if (rows.length === 0) return []
  const ids = rows.map(row => row.id)

  const bought = db
    .select({ itemId: purchases.itemId, userId: purchases.userId, name: users.displayName, quantity: purchases.quantity })
    .from(purchases)
    .innerJoin(users, eq(users.id, purchases.userId))
    .where(inArray(purchases.itemId, ids))
    .orderBy(asc(purchases.createdAt), asc(purchases.id))
    .all()

  const written = db
    .select({ id: notes.id, itemId: notes.itemId, userId: notes.userId, author: users.displayName, body: notes.body, createdAt: notes.createdAt })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.userId))
    .where(inArray(notes.itemId, ids))
    .orderBy(asc(notes.createdAt), asc(notes.id))
    .all()

  return rows.flatMap((row) => {
    const itemPurchases = bought.filter(p => p.itemId === row.id)
    const removed = row.deletedAt !== null
    // A deleted wish nobody bought is gone for everyone.
    if (removed && itemPurchases.length === 0) return []
    return [{
      ...toPublicItem(row),
      removed,
      bought: itemPurchases.reduce((sum, p) => sum + p.quantity, 0),
      purchases: itemPurchases.map(p => ({ name: p.name, quantity: p.quantity, mine: p.userId === viewerId })),
      notes: written.filter(n => n.itemId === row.id).map(n => ({
        id: n.id,
        author: n.author,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
        mine: n.userId === viewerId,
      })),
    }]
  })
}
