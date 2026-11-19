import { and, asc, count, desc, eq, isNull, max, notInArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { listOldTokens, listOwners, lists, listVisits, listWishes, users, wishes } from '../db/schema'
import type { ListTarget } from '../../shared/schemas/input'
import type { MyLists, OwnedList } from '../../shared/schemas/list'
import { DomainError } from './errors'
import { addNotice } from './notices'
import { onListNow, settleOwners, takeOffList } from './placement'
import { newListToken } from './tokens'

const MAX_LISTS_PER_USER = 50
// Deleted lists are kept, so a second ceiling stops someone filling the disk by making and deleting.
const MAX_LISTS_EVER = 200

/** Refuses when the person may not have one more list. */
export function assertListRoom(db: Db, userId: number): void {
  const { ever } = db.select({ ever: count() }).from(listOwners).where(eq(listOwners.userId, userId)).get()!
  // The lifetime ceiling first: once it is reached, deleting a list no longer makes room.
  if (ever >= MAX_LISTS_EVER) throw new DomainError('list_limit_ever')
  const { live } = db.select({ live: count() }).from(listOwners)
    .innerJoin(lists, eq(lists.id, listOwners.listId))
    .where(and(eq(listOwners.userId, userId), isNull(lists.deletedAt)))
    .get()!
  if (live >= MAX_LISTS_PER_USER) throw new DomainError('list_limit')
}

/** Makes the list and its owner. Runs in the caller's transaction, after `assertListRoom`. */
export function insertList(db: Db, userId: number, title: string): { id: number, token: string, title: string } {
  const list = db.insert(lists).values({ token: newListToken(), title }).returning().get()
  db.insert(listOwners).values({ listId: list.id, userId }).run()
  return { id: list.id, token: list.token, title: list.title }
}

export function createList(db: Db, userId: number, title: string): { token: string, title: string } {
  return db.transaction((tx) => {
    assertListRoom(tx, userId)
    const list = insertList(tx, userId, title)
    return { token: list.token, title: list.title }
  }, { behavior: 'immediate' })
}

/**
 * The list a wish from elsewhere should land on: a live list of the person's own, or a new one
 * made now. A list that isn't theirs is "not found". Runs in the caller's transaction.
 */
export function targetListId(db: Db, userId: number, target: ListTarget): { id: number, token: string, title: string } {
  if ('newList' in target) {
    assertListRoom(db, userId)
    return insertList(db, userId, target.newList)
  }
  const id = ownedListId(db, userId, target.list)
  return db.select({ id: lists.id, token: lists.token, title: lists.title }).from(lists).where(eq(lists.id, id)).get()!
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

/**
 * The wishes still marked as on the list, also those deleted before placements could be taken
 * off, so their owners are settled too.
 */
export function wishesMarkedOn(db: Db, listId: number): number[] {
  return db.select({ wishId: listWishes.wishId }).from(listWishes)
    .where(and(eq(listWishes.listId, listId), isNull(listWishes.removedAt))).all()
    .map(row => row.wishId)
}

/** The list's owners, in the order they joined. */
export function ownersOfList(db: Db, listId: number): { userId: number, name: string }[] {
  return db.select({ userId: listOwners.userId, name: users.displayName }).from(listOwners)
    .innerJoin(users, eq(users.id, listOwners.userId))
    .where(eq(listOwners.listId, listId))
    .orderBy(asc(listOwners.addedAt), asc(listOwners.userId))
    .all()
}

/**
 * Takes every wish off the list, then deletes the list. A wish that is on no other list is deleted
 * with it; a joint wish stays on the other lists, with their owners. A list that has other owners
 * can't be deleted: one owner may not take it away from the others, so they leave instead.
 */
export function deleteList(db: Db, userId: number, token: string): void {
  db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    if (ownersOfList(tx, listId).length > 1) throw new DomainError('list_shared')
    for (const wishId of wishesMarkedOn(tx, listId)) takeOffList(tx, listId, wishId)
    tx.update(lists).set({ deletedAt: new Date() }).where(eq(lists.id, listId)).run()
  }, { behavior: 'immediate' })
}

/**
 * Stops owning a joint list. The list and its wishes stay for the other owners; the person keeps
 * only the wishes that are also on another list of theirs. The last owner deletes it instead.
 */
export function leaveList(db: Db, userId: number, token: string): void {
  db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    if (ownersOfList(tx, listId).length === 1) throw new DomainError('last_owner')
    tx.delete(listOwners).where(and(eq(listOwners.listId, listId), eq(listOwners.userId, userId))).run()
    settleOwners(tx, wishesMarkedOn(tx, listId))
  }, { behavior: 'immediate' })
}

/**
 * Gives the list a new address; the one it had stops opening it for everyone. The list, its
 * wishes, its owners and its open share links stay as they are. Whoever doesn't own it loses it
 * from their visited lists, or those would hand them the new address; an owner sends it to whom
 * they choose. The other owners are told. The old address is kept, for the one thing it is
 * still good for (see `listOldTokens`). Nothing here looks at what buyers did, so it answers the
 * same whatever they did.
 */
export function relinkList(db: Db, userId: number, token: string): { token: string } {
  return db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    const list = tx.select({ title: lists.title }).from(lists).where(eq(lists.id, listId)).get()!
    const owners = ownersOfList(tx, listId).map(owner => owner.userId)
    const fresh = newListToken()
    tx.insert(listOldTokens).values({ token, listId }).run()
    tx.update(lists).set({ token: fresh }).where(eq(lists.id, listId)).run()
    tx.delete(listVisits).where(and(eq(listVisits.listId, listId), notInArray(listVisits.userId, owners))).run()
    for (const owner of owners) {
      if (owner !== userId) addNotice(tx, { userId: owner, kind: 'list_relinked', actorId: userId, title: list.title, listId })
    }
    return { token: fresh }
  }, { behavior: 'immediate' })
}

/**
 * The person's live lists, the one they had to do with last first: by when they last opened it,
 * or by when they became an owner when that is later or they never opened it. Two lists with
 * the same moment: the newer list, so the answer doesn't vary.
 */
export function listOwnedLists(db: Db, userId: number): OwnedList[] {
  // A visit from before the person owned the list must not hold a list they just joined back.
  const lastTouched = sql`max(${listOwners.addedAt}, coalesce(${listVisits.openedAt}, 0))`
  return db.select({ id: lists.id, token: lists.token, title: lists.title }).from(lists)
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    // Only the person's own visits: who else opened a list is nobody's business.
    .leftJoin(listVisits, and(eq(listVisits.listId, lists.id), eq(listVisits.userId, userId)))
    .where(and(eq(listOwners.userId, userId), isNull(lists.deletedAt)))
    .orderBy(desc(lastTouched), desc(lists.id))
    .all()
    .map(({ id, token, title }) => {
      const { total } = db.select({ total: count() }).from(listWishes)
        .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
        .innerJoin(lists, eq(lists.id, listWishes.listId))
        .where(and(eq(listWishes.listId, id), onListNow))
        .get()!
      const owners = ownersOfList(db, id)
      return {
        token,
        title,
        wishes: total,
        owners: owners.map(owner => owner.name),
        // By id, not by name: a co-owner with the person's own name is still someone else.
        sharedWith: owners.filter(owner => owner.userId !== userId).map(owner => owner.name),
      }
    })
}

/**
 * The person's live lists, oldest first, and the one a wish was most recently put on, so the
 * chooser can offer it first.
 */
export function listMyLists(db: Db, userId: number): MyLists {
  const mine = db.select({ token: lists.token, title: lists.title }).from(lists)
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(and(eq(listOwners.userId, userId), isNull(lists.deletedAt)))
    .orderBy(lists.id)
    .all()
  const latest = db.select({ token: lists.token }).from(listWishes)
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(and(eq(listOwners.userId, userId), isNull(lists.deletedAt)))
    .groupBy(lists.id)
    // Two lists used in the same millisecond: the newer list, so the answer doesn't vary.
    .orderBy(desc(max(listWishes.addedAt)), desc(lists.id))
    .get()
  return { lists: mine, last: latest?.token ?? null }
}
