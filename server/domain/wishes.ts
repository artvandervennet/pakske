import { and, eq, isNull } from 'drizzle-orm'
import type { WishInput, WishPatchInput } from '../../shared/schemas/input'
import type { PublicWish } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { listWishes, wishes } from '../db/schema'
import { DomainError } from './errors'
import { ownedListId } from './lists'
import { assertRoom, putOnList } from './placement'
import { toPublicWish } from './public-wishes'

// What an owner does with the wishes on their list. Nothing here reads what buyers did, so no
// answer can depend on it: a delete or a lower amount goes through the same way in every case.

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
    assertRoom(tx, listId)
    const wish = tx.insert(wishes).values(input).returning().get()
    putOnList(tx, listId, wish.id)
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
