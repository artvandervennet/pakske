import { and, asc, eq } from 'drizzle-orm'
import type { PublicWish } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { lists, listWishes, wishes } from '../db/schema'
import { onListNow } from './placement'

// What every viewer of a list gets for a wish. This file only knows about wishes and the list
// they are on; what buyers did lives elsewhere and is not imported here. A test checks that.

export function toPublicWish(row: typeof wishes.$inferSelect): PublicWish {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    // A wish from before it could have several links may hold nothing here.
    urls: row.urls ?? [],
    image: row.imageFile ? `/uploads/${row.imageFile}` : null,
    imageFromLink: row.imageFromLink,
    quantity: row.quantity,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The wishes on a list now, in the list's order. The order depends on nothing but what its owners did. */
export function livePublicWishes(db: Db, listId: number): PublicWish[] {
  return db.select({ wish: wishes }).from(listWishes)
    .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .where(and(eq(listWishes.listId, listId), onListNow))
    .orderBy(asc(listWishes.position), asc(wishes.createdAt), asc(wishes.id))
    .all()
    .map(({ wish }) => toPublicWish(wish))
}
