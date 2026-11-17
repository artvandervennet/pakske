import { and, count, eq, isNull } from 'drizzle-orm'
import type { WishInput, WishPatchInput } from '../../shared/schemas/input'
import type { PublicWish } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { listOwners, listWishes, wishOwners, wishes } from '../db/schema'
import { DomainError } from './errors'
import { ownedListId } from './lists'
import { toPublicWish } from './public-wishes'

// What an owner does with the wishes on their list. Nothing here reads what buyers did, so no
// answer can depend on it: a delete or a lower amount goes through the same way in every case.

const MAX_LIVE_WISHES = 200
// Deleted wishes are kept, so a second ceiling stops someone filling the disk by adding and deleting.
const MAX_WISHES_EVER = 500

/** The wish, if it is live and shown on this list; otherwise "not found". */
function liveWishRow(db: Db, listId: number, wishId: number) {
  const row = db.select({ wish: wishes }).from(wishes)
    .innerJoin(listWishes, eq(listWishes.wishId, wishes.id))
    .where(and(eq(wishes.id, wishId), isNull(wishes.deletedAt), eq(listWishes.listId, listId)))
    .get()
  if (!row) throw new DomainError('not_found')
  return row.wish
}

export function addWish(db: Db, userId: number, token: string, input: WishInput): PublicWish {
  return db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    const { live } = tx.select({ live: count() }).from(listWishes)
      .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
      .where(and(eq(listWishes.listId, listId), isNull(wishes.deletedAt)))
      .get()!
    const { ever } = tx.select({ ever: count() }).from(listWishes).where(eq(listWishes.listId, listId)).get()!
    // The lifetime ceiling first: once it is reached, deleting a wish no longer makes room.
    if (ever >= MAX_WISHES_EVER) throw new DomainError('wish_limit_ever')
    if (live >= MAX_LIVE_WISHES) throw new DomainError('wish_limit')

    const wish = tx.insert(wishes).values(input).returning().get()
    // In step one the owners of a wish are the owners of its list.
    const owners = tx.select({ userId: listOwners.userId }).from(listOwners).where(eq(listOwners.listId, listId)).all()
    for (const owner of owners) tx.insert(wishOwners).values({ wishId: wish.id, userId: owner.userId }).run()
    tx.insert(listWishes).values({ listId, wishId: wish.id }).run()
    return toPublicWish(wish)
  }, { behavior: 'immediate' })
}

/** Changes the fields that are given and leaves the others as they are. */
export function updateWish(db: Db, userId: number, token: string, wishId: number, change: WishPatchInput): PublicWish {
  const given = Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined))
  return db.transaction((tx) => {
    liveWishRow(tx, ownedListId(tx, userId, token), wishId)
    return toPublicWish(tx.update(wishes).set({ ...given, updatedAt: new Date() }).where(eq(wishes.id, wishId)).returning().get())
  }, { behavior: 'immediate' })
}

/** Takes the wish off the list. The row and its image stay, in every case. */
export function deleteWish(db: Db, userId: number, token: string, wishId: number): void {
  db.transaction((tx) => {
    liveWishRow(tx, ownedListId(tx, userId, token), wishId)
    tx.update(wishes).set({ deletedAt: new Date() }).where(eq(wishes.id, wishId)).run()
  }, { behavior: 'immediate' })
}

/** Sets or clears the image and returns the file it replaced, so the caller can remove it from disk. */
export function setWishImage(db: Db, userId: number, token: string, wishId: number, imageFile: string | null): { previous: string | null } {
  return db.transaction((tx) => {
    const current = liveWishRow(tx, ownedListId(tx, userId, token), wishId)
    tx.update(wishes).set({ imageFile, updatedAt: new Date() }).where(eq(wishes.id, wishId)).run()
    return { previous: current.imageFile }
  }, { behavior: 'immediate' })
}
