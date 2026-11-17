import { and, asc, eq, isNull } from 'drizzle-orm'
import type { PublicWish } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { listWishes, wishes } from '../db/schema'

// What every viewer of a list gets for a wish. This file only knows about wishes and the list
// they are on; what buyers did lives elsewhere and is not imported here. A test checks that.

export function toPublicWish(row: typeof wishes.$inferSelect): PublicWish {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    url: row.url,
    image: row.imageFile ? `/uploads/${row.imageFile}` : null,
    quantity: row.quantity,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The live wishes on a list, oldest first. The order never depends on anything but the wishes. */
export function livePublicWishes(db: Db, listId: number): PublicWish[] {
  return db.select({ wish: wishes }).from(listWishes)
    .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
    .where(and(eq(listWishes.listId, listId), isNull(wishes.deletedAt)))
    .orderBy(asc(wishes.createdAt), asc(wishes.id))
    .all()
    .map(({ wish }) => toPublicWish(wish))
}
