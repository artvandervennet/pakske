import { and, asc, count, eq, isNull } from 'drizzle-orm'
import type { DirectoryEntry, ListOwner, PublicItem } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { items, users } from '../db/schema'

// What the owner and visitors who are not logged in get. This file only knows about accounts
// and wishes; what buyers do lives elsewhere and is not imported here. A test checks that.

export function toPublicItem(row: typeof items.$inferSelect): PublicItem {
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

export function findOwner(db: Db, username: string): (ListOwner & { id: number }) | undefined {
  return db
    .select({ id: users.id, username: users.username, displayName: users.displayName, listIntro: users.listIntro })
    .from(users)
    .where(eq(users.username, username))
    .get()
}

/** The wishes on a list, oldest first. The order never depends on anything but the wishes. */
export function listPublicItems(db: Db, ownerId: number): PublicItem[] {
  return db
    .select()
    .from(items)
    .where(and(eq(items.userId, ownerId), isNull(items.deletedAt)))
    .orderBy(asc(items.createdAt), asc(items.id))
    .all()
    .map(toPublicItem)
}

/** Everyone with an account, for the home page. */
export function listDirectory(db: Db): DirectoryEntry[] {
  return db
    .select({ username: users.username, displayName: users.displayName, wishes: count(items.id) })
    .from(users)
    .leftJoin(items, and(eq(items.userId, users.id), isNull(items.deletedAt)))
    .groupBy(users.id)
    .orderBy(asc(users.displayName), asc(users.id))
    .all()
}
