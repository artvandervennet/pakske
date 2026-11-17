import { and, count, eq, isNull } from 'drizzle-orm'
import type { ItemInput } from '../../shared/schemas/input'
import type { PublicItem } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { items } from '../db/schema'
import { DomainError } from './errors'
import { toPublicItem } from './public-list'

// What the owner does with their own wishes. Nothing here reads what buyers did, so no answer
// can depend on it: a delete or a lower amount goes through the same way in every case.

const MAX_LIVE_ITEMS = 200
// Deleted wishes are kept, so a second ceiling stops someone filling the disk by adding and deleting.
const MAX_ITEMS_EVER = 500

const mine = (ownerId: number, itemId: number) =>
  and(eq(items.id, itemId), eq(items.userId, ownerId), isNull(items.deletedAt))

export function createItem(db: Db, ownerId: number, input: ItemInput, options: { maxItems?: number } = {}): PublicItem {
  return db.transaction((tx) => {
    const { live } = tx.select({ live: count() }).from(items).where(and(eq(items.userId, ownerId), isNull(items.deletedAt))).get()!
    const { ever } = tx.select({ ever: count() }).from(items).where(eq(items.userId, ownerId)).get()!
    if (live >= (options.maxItems ?? MAX_LIVE_ITEMS) || ever >= MAX_ITEMS_EVER) throw new DomainError('item_limit')
    return toPublicItem(tx.insert(items).values({ userId: ownerId, ...input }).returning().get())
  }, { behavior: 'immediate' })
}

export function updateItem(db: Db, ownerId: number, itemId: number, input: ItemInput): PublicItem {
  const row = db.update(items).set({ ...input, updatedAt: new Date() }).where(mine(ownerId, itemId)).returning().get()
  if (!row) throw new DomainError('not_found')
  return toPublicItem(row)
}

/** Takes the wish off the list. The row and its image stay, in every case. */
export function deleteItem(db: Db, ownerId: number, itemId: number): void {
  const row = db.update(items).set({ deletedAt: new Date() }).where(mine(ownerId, itemId)).returning({ id: items.id }).get()
  if (!row) throw new DomainError('not_found')
}

/** Sets or clears the image and returns the file it replaced, so the caller can remove it from disk. */
export function setItemImage(db: Db, ownerId: number, itemId: number, imageFile: string | null): { previous: string | null } {
  return db.transaction((tx) => {
    const current = tx.select({ imageFile: items.imageFile }).from(items).where(mine(ownerId, itemId)).get()
    if (!current) throw new DomainError('not_found')
    tx.update(items).set({ imageFile, updatedAt: new Date() }).where(eq(items.id, itemId)).run()
    return { previous: current.imageFile }
  }, { behavior: 'immediate' })
}
