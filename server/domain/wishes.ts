import { eq } from 'drizzle-orm'
import type { WishInput, WishPatchInput } from '../../shared/schemas/input'
import type { PublicWish } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { wishes } from '../db/schema'
import { DomainError } from './errors'
import { ownedListId } from './lists'
import { assertRoom, ownedWishOnList, putOnList, takeOffList, wishOnList } from './placement'
import { toPublicWish } from './public-wishes'
import { recordChanges, unusedImages } from './undo'

// What an owner does with the wishes on their list. Nothing here reads what buyers did, so no
// answer can depend on it: a delete or a lower amount goes through the same way in every case.

// It lives in placement.ts, next to the other ownership rules, so undo.ts can use it too.
export { ownedWishOnList }

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
  const given = Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined)) as WishPatchInput
  return db.transaction((tx) => {
    const current = ownedWishOnList(tx, userId, token, wishId)
    // What it returns are forgotten pictures, and a change without a picture can't forget one.
    recordChanges(tx, wishId, userId, current, given)
    return toPublicWish(tx.update(wishes).set({ ...given, updatedAt: new Date() }).where(eq(wishes.id, wishId)).returning().get())
  }, { behavior: 'immediate' })
}

/**
 * Takes the wish off this list of the person's own. It is deleted only when that leaves it with
 * no owners; a joint wish stays on the other lists. The row and its image stay, in every case.
 */
export function deleteWish(db: Db, userId: number, token: string, wishId: number): void {
  db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    if (!wishOnList(tx, token, wishId).live) throw new DomainError('not_found')
    takeOffList(tx, listId, wishId)
  }, { behavior: 'immediate' })
}

/**
 * Sets or clears the image. Returns the files nothing points at any more, so the caller can
 * remove them from disk: the one replaced, unless a copy or an undo still needs it, and any
 * earlier picture a link stopped remembering.
 */
export function setWishImage(db: Db, userId: number, token: string, wishId: number, imageFile: string | null): { unused: string[] } {
  return db.transaction((tx) => {
    const current = ownedWishOnList(tx, userId, token, wishId)
    const forgotten = recordChanges(tx, wishId, userId, current, { imageFile })
    tx.update(wishes).set({ imageFile, updatedAt: new Date() }).where(eq(wishes.id, wishId)).run()
    return { unused: unusedImages(tx, [current.imageFile, ...forgotten]) }
  }, { behavior: 'immediate' })
}
