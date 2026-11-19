import { and, count, eq, inArray, isNull, max, min, type SQL } from 'drizzle-orm'
import type { Db } from '../db/client'
import { listOldTokens, listOwners, lists, listWishes, wishOwners, wishes } from '../db/schema'
import { DomainError } from './errors'

// Which lists show a wish, and who owns it because of that. A wish belongs to the owners of the
// live lists that show it, and to nobody else; every way of taking a wish off a list goes through
// here, so that stays true. A list whose only owner deleted their account stays, owned by nobody,
// and so do its wishes. Nothing here reads what buyers did, so the answers can't depend on it.
// These helpers run inside the caller's transaction and open none of their own.

export const MAX_LIVE_WISHES = 200
// Deleted wishes are kept, so a second ceiling stops someone filling the disk by adding and deleting.
export const MAX_WISHES_EVER = 500

/** A placement that counts: on the list now, of a wish and on a list that both still exist. */
export const onListNow: SQL = and(isNull(listWishes.removedAt), isNull(wishes.deletedAt), isNull(lists.deletedAt))!

/**
 * The list behind a token and its placement of the wish, live or not. A wish taken off the list,
 * or deleted, or on a deleted list, still resolves, because buyers may still lower or take back
 * what they bought there. "Not found" is only a token that matches no list, or a wish that list
 * never showed.
 *
 * A list that got a new link has addresses it no longer answers to. With `old`, one of those
 * still resolves, as a placement that is never live and is marked `old`: for someone taking back
 * what they were giving there, and for nothing else (see `listOldTokens`). Without `old` such an
 * address is "not found", like one that never existed.
 */
export function wishOnList(db: Db, token: string, wishId: number, options: { old?: boolean } = {}) {
  const onList = (list: SQL) => db.select({ wish: wishes, list: lists, placement: listWishes }).from(lists)
    .innerJoin(listWishes, eq(listWishes.listId, lists.id))
    .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
    .where(and(list, eq(wishes.id, wishId)))
    .get()
  const row = onList(eq(lists.token, token))
  if (row) {
    const live = row.placement.removedAt === null && row.wish.deletedAt === null && row.list.deletedAt === null
    return { ...row, live, old: false }
  }
  const before = options.old
    ? db.select({ listId: listOldTokens.listId }).from(listOldTokens).where(eq(listOldTokens.token, token)).get()
    : undefined
  const left = before && onList(eq(lists.id, before.listId))
  if (!left) throw new DomainError('not_found')
  return { ...left, live: false, old: true }
}

export function ownsWish(db: Db, wishId: number, userId: number): boolean {
  return db.select({ userId: wishOwners.userId }).from(wishOwners)
    .where(and(eq(wishOwners.wishId, wishId), eq(wishOwners.userId, userId))).get() !== undefined
}

/**
 * The wish, if this list shows it now and the person owns it; otherwise "not found". The list
 * doesn't have to be theirs: an owner of a joint wish may change it wherever it is shown.
 */
export function ownedWishOnList(db: Db, userId: number, token: string, wishId: number) {
  const { wish, live } = wishOnList(db, token, wishId)
  if (!live || !ownsWish(db, wishId, userId)) throw new DomainError('not_found')
  return wish
}

/** Refuses when the list has no room for this many more wishes. */
export function assertRoom(db: Db, listId: number, adding = 1): void {
  const { ever } = db.select({ ever: count() }).from(listWishes).where(eq(listWishes.listId, listId)).get()!
  // The lifetime ceiling first: once it is reached, taking a wish off no longer makes room.
  if (ever + adding > MAX_WISHES_EVER) throw new DomainError('wish_limit_ever')
  const { live } = db.select({ live: count() }).from(listWishes)
    .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .where(and(eq(listWishes.listId, listId), onListNow))
    .get()!
  if (live + adding > MAX_LIVE_WISHES) throw new DomainError('wish_limit')
}

/**
 * Shows the wish on the list and makes the list's owners owners of the wish. A placement the wish
 * had there before comes back rather than a second row. The join order goes up with every
 * arrival, so a wish that comes back to a list ranks as having joined last. It goes to the bottom
 * of the list, unless the caller gives it a place of its own.
 */
export function putOnList(db: Db, listId: number, wishId: number, position?: number): void {
  const placements = db.select({ listId: listWishes.listId, joinOrder: listWishes.joinOrder, removedAt: listWishes.removedAt })
    .from(listWishes).where(eq(listWishes.wishId, wishId)).all()
  const here = placements.find(placement => placement.listId === listId)
  if (here && here.removedAt === null) return

  // A join order is only ever raised, so the highest one now is the highest one ever.
  const joinOrder = placements.length === 0 ? 0 : Math.max(...placements.map(placement => placement.joinOrder)) + 1
  const addedAt = new Date()
  const place = position ?? bottomOf(db, listId)
  if (here) {
    db.update(listWishes).set({ removedAt: null, addedAt, joinOrder, position: place })
      .where(and(eq(listWishes.listId, listId), eq(listWishes.wishId, wishId))).run()
  }
  else {
    db.insert(listWishes).values({ listId, wishId, addedAt, joinOrder, position: place }).run()
  }
  settleOwners(db, [wishId])
}

/** The position after every placement the list has had, live or not. */
function bottomOf(db: Db, listId: number): number {
  const { highest } = db.select({ highest: max(listWishes.position) }).from(listWishes)
    .where(eq(listWishes.listId, listId)).get()!
  return highest === null ? 0 : highest + 1
}

/** Takes the wish off the list, and returns the ids of the people who no longer own it. */
export function takeOffList(db: Db, listId: number, wishId: number): number[] {
  db.update(listWishes).set({ removedAt: new Date() })
    .where(and(eq(listWishes.listId, listId), eq(listWishes.wishId, wishId), isNull(listWishes.removedAt))).run()
  return settleOwners(db, [wishId]).map(gone => gone.userId)
}

/**
 * Makes the owners of each wish the owners of the live lists that show it, and deletes a wish no
 * live list shows any more. A list nobody owns (its owner's account is gone) still shows its
 * wishes, so a wish can stay without an owner. Returns who stopped owning which wish.
 */
export function settleOwners(db: Db, wishIds: number[]): { wishId: number, userId: number }[] {
  const stopped: { wishId: number, userId: number }[] = []
  for (const wishId of new Set(wishIds)) {
    const shownOn = db.select({ listId: listWishes.listId, userId: listOwners.userId }).from(listWishes)
      .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
      .innerJoin(lists, eq(lists.id, listWishes.listId))
      .leftJoin(listOwners, eq(listOwners.listId, lists.id))
      .where(and(eq(listWishes.wishId, wishId), onListNow))
      .all()
    const shouldOwn = new Set(shownOn.flatMap(row => row.userId ?? []))
    const owns = db.select({ userId: wishOwners.userId }).from(wishOwners).where(eq(wishOwners.wishId, wishId)).all()
      .map(row => row.userId)
      .sort((a, b) => a - b)

    const leaving = owns.filter(userId => !shouldOwn.has(userId))
    if (leaving.length > 0) {
      db.delete(wishOwners).where(and(eq(wishOwners.wishId, wishId), inArray(wishOwners.userId, leaving))).run()
    }
    for (const userId of shouldOwn) {
      if (!owns.includes(userId)) db.insert(wishOwners).values({ wishId, userId }).run()
    }
    if (shownOn.length === 0) {
      db.update(wishes).set({ deletedAt: new Date() }).where(and(eq(wishes.id, wishId), isNull(wishes.deletedAt))).run()
    }
    stopped.push(...leaving.map(userId => ({ wishId, userId })))
  }
  return stopped
}

/**
 * How early this person came to the wish: the lowest join order among the live lists of theirs
 * that show it, or null when they own it through none.
 */
export function standing(db: Db, wishId: number, userId: number): number | null {
  const { lowest } = db.select({ lowest: min(listWishes.joinOrder) }).from(listWishes)
    .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(and(eq(listWishes.wishId, wishId), eq(listOwners.userId, userId), onListNow))
    .get()!
  return lowest
}
