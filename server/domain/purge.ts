import { and, eq, isNotNull, isNull, lte, notExists, or, sql } from 'drizzle-orm'
import { KEPT_FOR_BUYERS_DAYS } from '../../shared/utils/kept-for-buyers'
import type { Db } from '../db/client'
import { friendLinks, invites, linkChanges, listOwners, lists, listWishes, users, wishLinks, wishes } from '../db/schema'
import { removeList } from './lists'
import { unusedImages } from './undo'

// Erasing what was deleted. Deleting a list or a wish only marks it, because whoever was getting
// something from it keeps seeing it for a while (shared/utils/kept-for-buyers.ts). Once that
// while is over nobody is shown it any more, and this takes it out of the database for good,
// with everything that hung on it. The server runs it once a day (server/plugins/03.cleanup.ts).

const DAY = 24 * 60 * 60 * 1000

/** How long a link that no longer works is kept, so its address can still say that it ended. */
export const CLOSED_LINK_DAYS = 30

/**
 * Erases what nobody is shown any more, as of `now`:
 * - a list deleted longer ago than a buyer keeps seeing it, with its placements, conversations,
 *   visits and links;
 * - a wish deleted that long ago, with what was ticked and written on it;
 * - a link to share wishes or a list, or to become friends, that was used up or ran out a while
 *   ago.
 * A live list that nobody owns is deleted first, as its owner would have: that is a list from
 * before an account took its own lists along. Returns the pictures nothing points at any more,
 * for the caller to remove.
 */
export function purge(db: Db, now = new Date()): { unused: string[] } {
  return db.transaction((tx) => {
    const nobodys = tx.select({ id: lists.id }).from(lists)
      .leftJoin(listOwners, eq(listOwners.listId, lists.id))
      .where(and(isNull(lists.deletedAt), isNull(listOwners.userId)))
      .all()
    for (const { id } of nobodys) removeList(tx, id)

    // A wish left its list when it, its placement or its list went, whichever came first, so a
    // wish or a list deleted before this moment is kept for nobody.
    const kept = new Date(now.getTime() - KEPT_FOR_BUYERS_DAYS * DAY)
    tx.delete(lists).where(lte(lists.deletedAt, kept)).run()

    // A wish no list has a row for can't be reached from anywhere.
    const placed = tx.select({ one: sql`1` }).from(listWishes).where(eq(listWishes.wishId, wishes.id))
    const gone = or(lte(wishes.deletedAt, kept), notExists(placed))
    const pictures = tx.select({ file: wishes.imageFile }).from(wishes).where(and(gone, isNotNull(wishes.imageFile))).all()
      .map(row => row.file)
    // A link on such a wish may keep an earlier picture for an undo nobody can ask for any more.
    const remembered = tx.select({ before: linkChanges.before }).from(linkChanges)
      .innerJoin(wishLinks, eq(wishLinks.id, linkChanges.linkId))
      .innerJoin(wishes, eq(wishes.id, wishLinks.wishId))
      .where(and(gone, eq(linkChanges.field, 'imageFile')))
      .all()
      .map(row => JSON.parse(row.before) as string | null)
    tx.delete(wishes).where(gone).run()

    const closed = new Date(now.getTime() - CLOSED_LINK_DAYS * DAY)
    tx.delete(invites).where(or(lte(invites.expiresAt, closed), lte(invites.usedAt, closed))).run()
    tx.delete(friendLinks).where(or(lte(friendLinks.expiresAt, closed), lte(friendLinks.usedAt, closed))).run()

    return { unused: unusedImages(tx, [...pictures, ...remembered]) }
  }, { behavior: 'immediate' })
}

/**
 * Every picture a row still points at: profile pictures, the pictures of wishes (a deleted wish
 * keeps its own until it is erased), and the earlier pictures a link keeps for an undo. A file in
 * the uploads folder that isn't among these belongs to nothing.
 */
export function picturesInUse(db: Db): Set<string> {
  const files = [
    ...db.select({ file: users.imageFile }).from(users).where(isNotNull(users.imageFile)).all(),
    ...db.select({ file: wishes.imageFile }).from(wishes).where(isNotNull(wishes.imageFile)).all(),
  ].map(row => row.file!)
  const remembered = db.select({ before: linkChanges.before }).from(linkChanges).where(eq(linkChanges.field, 'imageFile')).all()
    .flatMap(row => (JSON.parse(row.before) as string | null) ?? [])
  return new Set([...files, ...remembered])
}
