import { and, asc, eq, isNull } from 'drizzle-orm'
import { expect } from 'vitest'
import { openDb, type Db } from '../server/db/client'
import { listOwners, lists, listWishes, purchases, wishOwners, wishes } from '../server/db/schema'
import { createList } from '../server/domain/lists'
import { settleOwners } from '../server/domain/placement'
import { createUser } from '../server/domain/users'
import { addWish } from '../server/domain/wishes'
import { wishInput } from '../shared/schemas/input'
import type { ListView } from '../shared/schemas/list'

export function makeDb(): Db {
  return openDb(':memory:')
}

/**
 * An account without the first list every real one starts with (`createUser` makes it), so a
 * test holds only the lists it makes itself. The row goes from the tables, as if it never was:
 * a deleted list would still count toward how many lists a person ever made.
 */
export function addUser(db: Db, name: string) {
  const user = createUser(db, {
    email: `${name}@example.test`,
    displayName: name[0]!.toUpperCase() + name.slice(1),
    passwordHash: 'not-a-real-hash',
  })
  const first = db.select({ listId: listOwners.listId }).from(listOwners).where(eq(listOwners.userId, user.id)).all()
  for (const { listId } of first) db.delete(lists).where(eq(lists.id, listId)).run()
  return user
}

/** The code of the DomainError a function throws, or undefined when it doesn't throw. */
export function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  }
  catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
  return undefined
}

export function addList(db: Db, userId: number, title = 'Kerst'): string {
  return createList(db, userId, title).token
}

export function addWishTo(db: Db, userId: number, token: string, title: string, quantity: number | null = 1) {
  return addWish(db, userId, token, wishInput.parse({ title, quantity }))
}

/** The titles of the wishes a view shows, in its order. */
export const titles = (view: ListView | undefined) => view!.wishes.map(wish => wish.title)

/** One wish from a view, or undefined when the viewer doesn't get it. */
export const wishIn = (view: ListView | undefined, id: number) => view!.wishes.find(wish => wish.id === id)

/** What the purchases table holds for a wish, read straight from the table. */
export function purchaseRows(db: Db, wishId: number): { userId: number, quantity: number }[] {
  return db.select({ userId: purchases.userId, quantity: purchases.quantity }).from(purchases)
    .where(eq(purchases.wishId, wishId)).orderBy(asc(purchases.userId)).all()
}

/** Makes someone a co-owner of a list, straight in the tables. The real way in is a link. */
export function addOwner(db: Db, token: string, userId: number): void {
  const list = db.select({ id: lists.id }).from(lists).where(eq(lists.token, token)).get()!
  db.insert(listOwners).values({ listId: list.id, userId }).run()
  const onList = db.select({ wishId: listWishes.wishId }).from(listWishes).where(eq(listWishes.listId, list.id)).all()
  settleOwners(db, onList.map(row => row.wishId))
}

/** Who owns a wish, by id, from the table itself. */
export function ownerIds(db: Db, wishId: number): number[] {
  return db.select({ userId: wishOwners.userId }).from(wishOwners)
    .where(eq(wishOwners.wishId, wishId)).orderBy(asc(wishOwners.userId)).all()
    .map(row => row.userId)
}

/**
 * Checks the rule every action must leave behind, worked out here on its own rather than with
 * the code under test: a wish belongs to the owners of the live lists that show it, and it is
 * deleted exactly when that is nobody.
 */
export function expectOwnersSettled(db: Db): void {
  for (const wish of db.select({ id: wishes.id, deletedAt: wishes.deletedAt }).from(wishes).all()) {
    const shownBy = db.selectDistinct({ userId: listOwners.userId }).from(listWishes)
      .innerJoin(lists, eq(lists.id, listWishes.listId))
      .innerJoin(listOwners, eq(listOwners.listId, lists.id))
      .where(and(eq(listWishes.wishId, wish.id), isNull(listWishes.removedAt), isNull(lists.deletedAt)))
      .all()
      .map(row => row.userId)
      .sort((a, b) => a - b)
    expect(ownerIds(db, wish.id), `owners of wish ${wish.id}`).toEqual(shownBy)
    expect(wish.deletedAt !== null, `wish ${wish.id} deleted`).toBe(shownBy.length === 0)
  }
}
