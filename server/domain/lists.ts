import { and, count, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/client'
import { listOwners, lists, listWishes, wishes } from '../db/schema'
import type { HomeList } from '../../shared/schemas/list'
import { DomainError } from './errors'
import { newListToken } from './tokens'

const MAX_LISTS_PER_USER = 50
// Deleted lists are kept, so a second ceiling stops someone filling the disk by making and deleting.
const MAX_LISTS_EVER = 200

export function createList(db: Db, userId: number, title: string): { token: string, title: string } {
  return db.transaction((tx) => {
    const { ever } = tx.select({ ever: count() }).from(listOwners).where(eq(listOwners.userId, userId)).get()!
    // The lifetime ceiling first: once it is reached, deleting a list no longer makes room.
    if (ever >= MAX_LISTS_EVER) throw new DomainError('list_limit_ever')
    const { live } = tx.select({ live: count() }).from(listOwners)
      .innerJoin(lists, eq(lists.id, listOwners.listId))
      .where(and(eq(listOwners.userId, userId), isNull(lists.deletedAt)))
      .get()!
    if (live >= MAX_LISTS_PER_USER) throw new DomainError('list_limit')
    const list = tx.insert(lists).values({ token: newListToken(), title }).returning().get()
    tx.insert(listOwners).values({ listId: list.id, userId }).run()
    return { token: list.token, title: list.title }
  }, { behavior: 'immediate' })
}

/** The id of a live list this person owns. Anything else is "not found", so a stranger learns nothing. */
export function ownedListId(db: Db, userId: number, token: string): number {
  const row = db.select({ id: lists.id }).from(lists)
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(and(eq(lists.token, token), eq(listOwners.userId, userId), isNull(lists.deletedAt)))
    .get()
  if (!row) throw new DomainError('not_found')
  return row.id
}

export function renameList(db: Db, userId: number, token: string, title: string): void {
  db.update(lists).set({ title }).where(eq(lists.id, ownedListId(db, userId, token))).run()
}

export function deleteList(db: Db, userId: number, token: string): void {
  db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    const now = new Date()
    // Wishes go with the list, so they stop showing up for buyers as well.
    const onList = tx.select({ wishId: listWishes.wishId }).from(listWishes).where(eq(listWishes.listId, listId)).all()
    for (const { wishId } of onList) {
      tx.update(wishes).set({ deletedAt: now }).where(and(eq(wishes.id, wishId), isNull(wishes.deletedAt))).run()
    }
    tx.update(lists).set({ deletedAt: now }).where(eq(lists.id, listId)).run()
  }, { behavior: 'immediate' })
}

export function listOwnedLists(db: Db, userId: number): HomeList[] {
  return db.select({ id: lists.id, token: lists.token, title: lists.title }).from(lists)
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(and(eq(listOwners.userId, userId), isNull(lists.deletedAt)))
    .orderBy(lists.id)
    .all()
    .map(({ id, token, title }) => {
      const { total } = db.select({ total: count() }).from(listWishes)
        .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
        .where(and(eq(listWishes.listId, id), isNull(wishes.deletedAt)))
        .get()!
      return { token, title, wishes: total }
    })
}
