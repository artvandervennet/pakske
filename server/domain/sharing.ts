import { and, asc, eq, inArray } from 'drizzle-orm'
import type { ListTarget } from '../../shared/schemas/input'
import type { Db } from '../db/client'
import { listOwners, lists, listWishes, wishLinks, wishOwners, wishes } from '../db/schema'
import { DomainError } from './errors'
import { targetListId } from './lists'
import { addNotice } from './notices'
import { assertRoom, onListNow, ownedWishOnList, ownsWish, putOnList, standing, takeOffList, wishOnList } from './placement'

// "Add to my list": a wish from someone else's list put on one of your own, linked or as a copy,
// and unlinking someone from a joint wish. Nothing here reads what buyers did, so these answer
// the same way whatever was bought, and an already bought wish can be linked like any other.

type Landed = { token: string, title: string, wishId: number }

/** The wish on that list, if it is there now and the person doesn't own it yet. */
function wishToAdd(db: Db, userId: number, token: string, wishId: number) {
  const { wish, live } = wishOnList(db, token, wishId)
  if (!live) throw new DomainError('wish_removed')
  if (ownsWish(db, wishId, userId)) throw new DomainError('forbidden')
  return wish
}

/**
 * Linked: the same wish goes on the person's list and they own it at once. The owners it had
 * are told, and the link is remembered so they can undo it.
 */
export function linkWish(db: Db, userId: number, token: string, wishId: number, target: ListTarget): Landed {
  return db.transaction((tx) => {
    const wish = wishToAdd(tx, userId, token, wishId)
    const list = targetListId(tx, userId, target)
    assertRoom(tx, list.id)
    const earlier = tx.select({ userId: wishOwners.userId }).from(wishOwners).where(eq(wishOwners.wishId, wishId)).all()
    putOnList(tx, list.id, wishId)
    // A link made before (and later taken off the list) stays the same link, with what it remembers.
    tx.insert(wishLinks).values({ wishId, userId }).onConflictDoNothing().run()
    for (const owner of earlier) {
      addNotice(tx, { userId: owner.userId, kind: 'wish_linked', actorId: userId, title: wish.title, wishId })
    }
    return { token: list.token, title: list.title, wishId }
  }, { behavior: 'immediate' })
}

/**
 * Copy: a new wish of the person's own with the same title, text, link, picture and amount. It
 * has nothing to do with the original afterwards, and nobody is told.
 */
export function copyWish(db: Db, userId: number, token: string, wishId: number, target: ListTarget): Landed {
  return db.transaction((tx) => {
    const wish = wishToAdd(tx, userId, token, wishId)
    const list = targetListId(tx, userId, target)
    assertRoom(tx, list.id)
    const copy = tx.insert(wishes).values({
      title: wish.title,
      description: wish.description,
      url: wish.url,
      imageFile: wish.imageFile,
      quantity: wish.quantity,
    }).returning({ id: wishes.id }).get()
    putOnList(tx, list.id, copy.id)
    return { token: list.token, title: list.title, wishId: copy.id }
  }, { behavior: 'immediate' })
}

/** The lists of this person's that show the wish now, with when the wish came to each. */
function theirPlacements(db: Db, wishId: number, userId: number) {
  return db.select({ listId: listWishes.listId, joinOrder: listWishes.joinOrder }).from(listWishes)
    .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(and(eq(listWishes.wishId, wishId), eq(listOwners.userId, userId), onListNow))
    .orderBy(asc(listWishes.listId))
    .all()
}

/**
 * Whether the actor may unlink the target: both own the wish, and the wish came to every list of
 * the target's after it came to the actor. So nobody can unlink someone who was there before
 * them, and the owners of one list, who came at the same moment, can't unlink each other.
 */
export function mayUnlink(db: Db, wishId: number, actorId: number, targetId: number): boolean {
  if (actorId === targetId || !ownsWish(db, wishId, actorId) || !ownsWish(db, wishId, targetId)) return false
  const actorStanding = standing(db, wishId, actorId)
  if (actorStanding === null) return false
  return theirPlacements(db, wishId, targetId).every(placement => placement.joinOrder > actorStanding)
}

/**
 * Takes the wish off every list of the target's and leaves each of those lists a plain copy of it
 * as it is now. The copy is not counted against the list's limits: whoever is unlinked didn't
 * choose it, so it must never fail. Everyone who stopped owning the wish is told, pointing at the
 * copy on their list. The wish itself doesn't change. Runs in the caller's transaction, and only
 * after the caller has checked `mayUnlink`.
 */
export function unlink(db: Db, actorId: number, wishId: number, targetId: number): void {
  const wish = db.select().from(wishes).where(eq(wishes.id, wishId)).get()!
  const copies = new Map<number, number>()
  const stopped = new Set<number>()
  for (const { listId } of theirPlacements(db, wishId, targetId)) {
    for (const userId of takeOffList(db, listId, wishId)) stopped.add(userId)
    const copy = db.insert(wishes).values({
      title: wish.title,
      description: wish.description,
      url: wish.url,
      imageFile: wish.imageFile,
      quantity: wish.quantity,
      // Lists are in the order wishes were made, so this keeps the copy where the wish was.
      createdAt: wish.createdAt,
    }).returning({ id: wishes.id }).get()
    putOnList(db, listId, copy.id)
    copies.set(listId, copy.id)
  }
  for (const userId of stopped) {
    // Someone stopped owning the wish only because one of these lists is theirs.
    const theirs = db.select({ listId: listOwners.listId }).from(listOwners)
      .where(and(eq(listOwners.userId, userId), inArray(listOwners.listId, [...copies.keys()])))
      .orderBy(asc(listOwners.listId))
      .get()!
    addNotice(db, { userId, kind: 'wish_unlinked', actorId, title: wish.title, wishId: copies.get(theirs.listId) })
  }
}

/** "Unlink", in the unfolded wish: an owner removes someone who became an owner after them. */
export function unlinkOwner(db: Db, actorId: number, token: string, wishId: number, targetId: number): void {
  db.transaction((tx) => {
    ownedWishOnList(tx, actorId, token, wishId)
    if (!ownsWish(tx, wishId, targetId)) throw new DomainError('not_found')
    if (!mayUnlink(tx, wishId, actorId, targetId)) throw new DomainError('forbidden')
    unlink(tx, actorId, wishId, targetId)
  }, { behavior: 'immediate' })
}
