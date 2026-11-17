import { and, eq } from 'drizzle-orm'
import type { ListTarget } from '../../shared/schemas/input'
import type { Db } from '../db/client'
import { wishLinks, wishOwners, wishes } from '../db/schema'
import { DomainError } from './errors'
import { targetListId } from './lists'
import { addNotice } from './notices'
import { assertRoom, putOnList, wishOnList } from './placement'

// "Add to my list": a wish from someone else's list put on one of your own, linked or as a copy.
// Nothing here reads what buyers did, so linking and copying answer the same way whatever was
// bought, and an already bought wish can be linked like any other.

type Landed = { token: string, title: string, wishId: number }

/** The wish on that list, if it is there now and the person doesn't own it yet. */
function wishToAdd(db: Db, userId: number, token: string, wishId: number) {
  const { wish, live } = wishOnList(db, token, wishId)
  if (!live) throw new DomainError('wish_removed')
  const owns = db.select({ userId: wishOwners.userId }).from(wishOwners)
    .where(and(eq(wishOwners.wishId, wishId), eq(wishOwners.userId, userId))).get()
  if (owns) throw new DomainError('forbidden')
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
