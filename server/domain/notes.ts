import { and, count, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { notes, wishOwners } from '../db/schema'
import { DomainError } from './errors'
import { wishOnList } from './purchases'

const MAX_NOTES_PER_WISH = 200

/** A note on a wish, for the other buyers. An owner of the wish can't write or read them. */
export function addNote(db: Db, token: string, wishId: number, userId: number, body: string): { id: string } {
  return db.transaction((tx) => {
    wishOnList(tx, token, wishId)
    const owner = tx.select().from(wishOwners)
      .where(and(eq(wishOwners.wishId, wishId), eq(wishOwners.userId, userId))).get()
    if (owner) throw new DomainError('forbidden')
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
