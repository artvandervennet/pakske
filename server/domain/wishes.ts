import { and, eq } from 'drizzle-orm'
import type { WishInput, WishPatchInput } from '../../shared/schemas/input'
import type { PublicWish } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { listWishes, wishes } from '../db/schema'
import { DomainError } from './errors'
import { ownedListId } from './lists'
import { assertRoom, ownedWishOnList, putOnList, takeOffList, wishOnList } from './placement'
import { livePublicWishes, toPublicWish } from './public-wishes'
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

/** The wish's links. A wish from before it could have several may hold no list at all. */
const linksOf = (wish: typeof wishes.$inferSelect): string[] => wish.urls ?? []

/** Whether the wish's picture is a photo its owner put up, which no link ever replaces or removes. */
const hasOwnPhoto = (wish: typeof wishes.$inferSelect): boolean => wish.imageFile !== null && !wish.imageFromLink

/**
 * Changes the fields that are given and leaves the others as they are.
 *
 * A picture that is the cover of the first link goes when that link changes or goes, in the same
 * step, so a wish never shows one shop's picture beside another shop's link. `coverOf` is then
 * the new first link, for the caller to fetch its cover: only when the first link changed and
 * the wish has no photo of its owner's. `unused` are the files nothing points at any more.
 */
export function updateWish(db: Db, userId: number, token: string, wishId: number, change: WishPatchInput): { wish: PublicWish, unused: string[], coverOf: string | null } {
  const given = Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined)) as WishPatchInput
  return db.transaction((tx) => {
    const current = ownedWishOnList(tx, userId, token, wishId)
    const first = given.urls?.[0] ?? null
    const firstChanged = given.urls !== undefined && first !== (linksOf(current)[0] ?? null)
    const dropCover = firstChanged && current.imageFromLink
    const set = dropCover ? { ...given, imageFile: null, imageFromLink: false } : given
    const forgotten = recordChanges(tx, wishId, userId, current, set)
    const wish = tx.update(wishes).set({ ...set, updatedAt: new Date() }).where(eq(wishes.id, wishId)).returning().get()
    return {
      wish: toPublicWish(wish),
      unused: unusedImages(tx, [...(dropCover ? [current.imageFile] : []), ...forgotten]),
      coverOf: firstChanged && !hasOwnPhoto(current) ? first : null,
    }
  }, { behavior: 'immediate' })
}

/**
 * Takes the wish off this list of the person's own. It is deleted only when no other list shows
 * it; a joint wish stays on the other lists. The row and its image stay, in every case.
 */
export function deleteWish(db: Db, userId: number, token: string, wishId: number): void {
  db.transaction((tx) => {
    ownedListId(tx, userId, token)
    if (!wishOnList(tx, token, wishId).live) throw new DomainError('not_found')
    takeOff(tx, userId, token, [wishId])
  }, { behavior: 'immediate' })
}

/**
 * Takes several wishes off this list of the person's own, each the way `deleteWish` does. A wish
 * that is no longer on the list, because a co-owner took it off meanwhile, is skipped rather than
 * failing the others.
 */
export function deleteWishes(db: Db, userId: number, token: string, wishIds: number[]): void {
  db.transaction(tx => takeOff(tx, userId, token, wishIds), { behavior: 'immediate' })
}

function takeOff(db: Db, userId: number, token: string, wishIds: number[]): void {
  const listId = ownedListId(db, userId, token)
  const live = new Set(liveIdsInOrder(db, listId))
  for (const wishId of wishIds) {
    if (live.has(wishId)) takeOffList(db, listId, wishId)
  }
}

/**
 * Puts the given wishes first, in the given order. The wishes on the list that aren't given keep
 * their order and come after them, so a wish a co-owner added meanwhile isn't lost; ids that are
 * not on the list now are ignored.
 */
export function reorderWishes(db: Db, userId: number, token: string, wishIds: number[]): void {
  db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    const current = liveIdsInOrder(tx, listId)
    const live = new Set(current)
    const given = wishIds.filter(id => live.has(id))
    const chosen = new Set(given)
    const order = [...given, ...current.filter(id => !chosen.has(id))]
    order.forEach((wishId, position) => {
      tx.update(listWishes).set({ position })
        .where(and(eq(listWishes.listId, listId), eq(listWishes.wishId, wishId))).run()
    })
  }, { behavior: 'immediate' })
}

/** The ids of the wishes on the list now, in the list's order. */
function liveIdsInOrder(db: Db, listId: number): number[] {
  return livePublicWishes(db, listId).map(wish => wish.id)
}

/**
 * Sets or clears the photo an owner put up themselves; it replaces a link's cover too. Returns
 * the files nothing points at any more, so the caller can remove them from disk: the one
 * replaced, unless a copy or an undo still needs it, and any earlier picture a link stopped
 * remembering. `coverOf` is the first link when an own photo was removed, for the caller to
 * fetch its cover again. Removing a cover asks for nothing: the owner didn't want that picture.
 */
export function setWishImage(db: Db, userId: number, token: string, wishId: number, imageFile: string | null): { unused: string[], coverOf: string | null } {
  return db.transaction((tx) => {
    const current = ownedWishOnList(tx, userId, token, wishId)
    const forgotten = recordChanges(tx, wishId, userId, current, { imageFile, imageFromLink: false })
    tx.update(wishes).set({ imageFile, imageFromLink: false, updatedAt: new Date() }).where(eq(wishes.id, wishId)).run()
    return {
      unused: unusedImages(tx, [current.imageFile, ...forgotten]),
      coverOf: imageFile === null && hasOwnPhoto(current) ? linksOf(current)[0] ?? null : null,
    }
  }, { behavior: 'immediate' })
}

/**
 * Makes the cover that was fetched for `address` the wish's picture. The fetch took a while, so
 * the wish may have moved on: when `address` is no longer its first link, or its owner put up a
 * photo meanwhile, nothing changes, `wish` is null and the new file is among `unused`. Otherwise
 * `unused` holds the cover it replaced, like `setWishImage`.
 */
export function setWishCover(db: Db, userId: number, token: string, wishId: number, address: string, imageFile: string): { wish: PublicWish | null, unused: string[] } {
  return db.transaction((tx) => {
    const current = ownedWishOnList(tx, userId, token, wishId)
    if (linksOf(current)[0] !== address || hasOwnPhoto(current)) return { wish: null, unused: unusedImages(tx, [imageFile]) }
    const forgotten = recordChanges(tx, wishId, userId, current, { imageFile, imageFromLink: true })
    const wish = tx.update(wishes).set({ imageFile, imageFromLink: true, updatedAt: new Date() }).where(eq(wishes.id, wishId)).returning().get()
    return { wish: toPublicWish(wish), unused: unusedImages(tx, [current.imageFile, ...forgotten]) }
  }, { behavior: 'immediate' })
}
