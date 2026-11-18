import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { linkChanges, notices, wishLinks, wishes } from '../db/schema'
import { DomainError } from './errors'
import { ownedWishOnList, ownsWish } from './placement'
import { mayUnlink, unlink } from './sharing'

// Undo on a "Linked" notice: the earlier owners take back a link, and with it what the linker
// changed. For that, each link remembers what a field held before the linker first changed it,
// and keeps a replaced picture on disk, until the last notice about the link is dismissed. From
// then on the changes are simply the wish. Nothing here reads what buyers did, so undo answers
// the same way whatever was bought.

export type LinkField = 'title' | 'description' | 'urls' | 'quantity' | 'imageFile' | 'imageFromLink'
type WishRow = typeof wishes.$inferSelect

const LINK_FIELDS: readonly LinkField[] = ['title', 'description', 'urls', 'quantity', 'imageFile', 'imageFromLink']
const isLinkField = (field: string): field is LinkField => (LINK_FIELDS as readonly string[]).includes(field)

/**
 * What a field of the wish holds. A wish from before it could have several links may hold no
 * list at all, which is an empty one.
 */
const held = (wish: WishRow, field: LinkField) => field === 'urls' ? wish.urls ?? [] : wish[field]

/** Whether two values of a field are the same. Links are a list, so they are compared by what they hold. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Remembers what a linker is about to change, before they change it. Someone else's change to a
 * field is newer than the linker's, so undoing the link must not put that field back: every
 * other link on the wish forgets it. Because of that, a field is only ever remembered by the link
 * of whoever changed it last. Returns the earlier pictures forgotten that way, which may now be
 * unused. Runs in the caller's transaction.
 */
export function recordChanges(db: Db, wishId: number, userId: number, before: WishRow, after: Partial<Pick<WishRow, LinkField>>): string[] {
  const links = db.select({ id: wishLinks.id, userId: wishLinks.userId }).from(wishLinks).where(eq(wishLinks.wishId, wishId)).all()
  const own = links.find(link => link.userId === userId)
  const others = links.filter(link => link.userId !== userId).map(link => link.id)
  const forgotten: string[] = []
  const pictureChanged = after.imageFile !== undefined && after.imageFile !== before.imageFile
  for (const field of LINK_FIELDS) {
    // Where a picture came from (a link's cover, or the owner's own photo) goes with the picture:
    // remembered and forgotten together, also when one cover replaces another. Otherwise an undo
    // could put back "an own photo" beside a newer cover, which a new link then wouldn't replace.
    const changed = field === 'imageFromLink'
      ? pictureChanged
      : after[field] !== undefined && !same(after[field], held(before, field))
    if (!changed) continue
    if (own) {
      // Only the first change counts: undo goes back to the wish as it was before the linker came.
      db.insert(linkChanges).values({ linkId: own.id, field, before: JSON.stringify(held(before, field)) }).onConflictDoNothing().run()
    }
    if (others.length > 0) {
      const gone = db.delete(linkChanges).where(and(inArray(linkChanges.linkId, others), eq(linkChanges.field, field)))
        .returning({ before: linkChanges.before }).all()
      if (field === 'imageFile') forgotten.push(...pictures(gone))
    }
  }
  return forgotten
}

/** The picture files among remembered values; an empty picture is remembered as null. */
function pictures(rows: { before: string }[]): string[] {
  return rows.map(row => JSON.parse(row.before) as string | null).filter(file => file !== null)
}

/**
 * Of these files, the ones nothing points at any more: no wish (a deleted one keeps its picture
 * for the buyers who still see it) and no link that may put it back.
 */
export function unusedImages(db: Db, files: (string | null)[]): string[] {
  const unused: string[] = []
  for (const file of new Set(files)) {
    if (file === null) continue
    const onWish = db.select({ id: wishes.id }).from(wishes).where(eq(wishes.imageFile, file)).get()
    const remembered = db.select({ linkId: linkChanges.linkId }).from(linkChanges)
      .where(and(eq(linkChanges.field, 'imageFile'), eq(linkChanges.before, JSON.stringify(file)))).get()
    if (!onWish && !remembered) unused.push(file)
  }
  return unused
}

const linkedNotices = (wishId: number, linkerId: number) =>
  and(eq(notices.kind, 'wish_linked'), eq(notices.wishId, wishId), eq(notices.actorId, linkerId))

/**
 * "Undo" on a notice that someone linked a wish: what the linker changed goes back, then the
 * linker is unlinked if they still own the wish, and the link and its notices go. The fields go
 * back even when the linker already took the wish off their own list. Returns the pictures
 * nothing uses any more.
 */
export function undoLink(db: Db, userId: number, token: string, wishId: number, linkerId: number): { unused: string[] } {
  return db.transaction((tx) => {
    const wish = ownedWishOnList(tx, userId, token, wishId)
    const held = tx.select({ id: notices.id }).from(notices).where(and(eq(notices.userId, userId), linkedNotices(wishId, linkerId))).get()
    if (!held) throw new DomainError('not_found')

    const link = tx.select({ id: wishLinks.id }).from(wishLinks)
      .where(and(eq(wishLinks.wishId, wishId), eq(wishLinks.userId, linkerId))).get()
    const replaced: (string | null)[] = []
    if (link) {
      const remembered = tx.select().from(linkChanges).where(eq(linkChanges.linkId, link.id)).all()
      const back: Partial<Pick<WishRow, LinkField>> = {}
      for (const row of remembered) {
        if (isLinkField(row.field)) Object.assign(back, { [row.field]: JSON.parse(row.before) })
      }
      if ('imageFile' in back) {
        replaced.push(wish.imageFile)
        // A picture remembered before covers existed says nothing about where it came from. It was a photo.
        back.imageFromLink ??= false
      }
      if (Object.keys(back).length > 0) {
        tx.update(wishes).set({ ...back, updatedAt: new Date() }).where(eq(wishes.id, wishId)).run()
      }
    }

    // The caller may have come back to the wish after the linker did; then the linker stays.
    if (ownsWish(tx, wishId, linkerId) && mayUnlink(tx, wishId, userId, linkerId)) unlink(tx, userId, wishId, linkerId)

    // Deleting the link also deletes what it remembered.
    if (link) tx.delete(wishLinks).where(eq(wishLinks.id, link.id)).run()
    tx.delete(notices).where(linkedNotices(wishId, linkerId)).run()
    return { unused: unusedImages(tx, replaced) }
  }, { behavior: 'immediate' })
}

/**
 * Removes one of the person's notices. When it was the last notice about a link, the link is
 * no longer undone by anyone, so it stops remembering, and the earlier pictures it kept may now
 * be unused.
 */
export function dismissNotice(db: Db, userId: number, noticeId: string): { unused: string[] } {
  return db.transaction((tx) => {
    const notice = tx.select().from(notices).where(and(eq(notices.id, noticeId), eq(notices.userId, userId))).get()
    if (!notice) throw new DomainError('not_found')
    tx.delete(notices).where(eq(notices.id, notice.id)).run()
    if (notice.kind !== 'wish_linked' || notice.wishId === null) return { unused: [] }

    const others = tx.select({ id: notices.id }).from(notices).where(linkedNotices(notice.wishId, notice.actorId)).get()
    if (others) return { unused: [] }
    const link = tx.select({ id: wishLinks.id }).from(wishLinks)
      .where(and(eq(wishLinks.wishId, notice.wishId), eq(wishLinks.userId, notice.actorId))).get()
    if (!link) return { unused: [] }
    const kept = pictures(tx.select({ before: linkChanges.before }).from(linkChanges)
      .where(and(eq(linkChanges.linkId, link.id), eq(linkChanges.field, 'imageFile'))).all())
    tx.delete(wishLinks).where(eq(wishLinks.id, link.id)).run()
    return { unused: unusedImages(tx, kept) }
  }, { behavior: 'immediate' })
}
