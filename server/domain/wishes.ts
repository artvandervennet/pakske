import { and, eq } from 'drizzle-orm'
import type { WishInput, WishPatchInput } from '../../shared/schemas/input'
import type { PublicWish } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { wishOwners, wishes } from '../db/schema'
import { DomainError } from './errors'
import { ownedListId } from './lists'
import { assertRoom, putOnList, takeOffList, wishOnList } from './placement'
import { toPublicWish } from './public-wishes'

// What an owner does with the wishes on their list. Nothing here reads what buyers did, so no
// answer can depend on it: a delete or a lower amount goes through the same way in every case.

/**
 * The wish, if this list shows it now and the person owns it; otherwise "not found". The list
 * doesn't have to be theirs: an owner of a joint wish may change it wherever it is shown.
 */
export function ownedWishOnList(db: Db, userId: number, token: string, wishId: number) {
  const { wish, live } = wishOnList(db, token, wishId)
  const owns = db.select({ userId: wishOwners.userId }).from(wishOwners)
    .where(and(eq(wishOwners.wishId, wishId), eq(wishOwners.userId, userId))).get()
  if (!live || !owns) throw new DomainError('not_found')
  return wish
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
    ownedWishOnList(tx, userId, token, wishId)
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

/** Sets or clears the image and returns the file it replaced, so the caller can remove it from disk. */
export function setWishImage(db: Db, userId: number, token: string, wishId: number, imageFile: string | null): { previous: string | null } {
  return db.transaction((tx) => {
    const current = ownedWishOnList(tx, userId, token, wishId)
    tx.update(wishes).set({ imageFile, updatedAt: new Date() }).where(eq(wishes.id, wishId)).run()
    return { previous: current.imageFile }
  }, { behavior: 'immediate' })
}
