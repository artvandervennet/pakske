import { and, count, eq } from 'drizzle-orm'
import { keptForBuyers, leftListAt } from '../../shared/utils/kept-for-buyers'
import type { Db } from '../db/client'
import { listOwners, notes, purchases, wishOwners } from '../db/schema'
import { DomainError } from './errors'
import { wishOnList } from './placement'

const MAX_NOTES_PER_WISH = 200

/**
 * A note on a wish, for the other buyers. An owner of the wish or of the list can't write or read
 * them. A wish that left the list is still there for whoever bought it, for a while
 * (`keptForBuyers`), and for nobody else; for anyone else and after that it is "not found", as
 * on the list's page.
 */
export function addNote(db: Db, token: string, wishId: number, userId: number, body: string): { id: string } {
  return db.transaction((tx) => {
    const { list, wish, placement } = wishOnList(tx, token, wishId)
    const owner = tx.select().from(wishOwners)
      .where(and(eq(wishOwners.wishId, wishId), eq(wishOwners.userId, userId))).get()
    // The list's owners too: one who took the wish off no longer owns it, but must not learn
    // anything about its notes through the list it left.
    const listOwner = tx.select().from(listOwners)
      .where(and(eq(listOwners.listId, list.id), eq(listOwners.userId, userId))).get()
    if (owner || listOwner) throw new DomainError('forbidden')
    // The person's own row alone decides, so the answer says nothing about what anyone else bought.
    const leftAt = leftListAt(placement.removedAt, wish.deletedAt, list.deletedAt)
    if (leftAt) {
      const bought = tx.select({ id: purchases.id }).from(purchases)
        .where(and(eq(purchases.wishId, wishId), eq(purchases.userId, userId))).get()
      if (!bought || !keptForBuyers(leftAt, placement.clearedAt, new Date())) throw new DomainError('not_found')
    }
    // Only after the owner is turned away: counting first would tell an owner that notes exist.
    const { total } = tx.select({ total: count() }).from(notes).where(eq(notes.wishId, wishId)).get()!
    if (total >= MAX_NOTES_PER_WISH) throw new DomainError('note_limit')
    return tx.insert(notes).values({ wishId, userId, body }).returning({ id: notes.id }).get()
  }, { behavior: 'immediate' })
}

/**
 * Deletes the author's own note. For anyone else the answer is "not found", the same as for a
 * note that doesn't exist, so nobody can find out whether a note is there.
 */
export function deleteNote(db: Db, noteId: string, userId: number): void {
  const row = db.delete(notes).where(and(eq(notes.id, noteId), eq(notes.userId, userId))).returning({ id: notes.id }).get()
  if (!row) throw new DomainError('not_found')
}
