import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { items, notes } from '../db/schema'
import { DomainError } from './errors'

/** A note on a wish, for the other buyers. The owner of the list can't write or read them. */
export function addNote(db: Db, itemId: number, authorId: number, body: string): { id: string } {
  return db.transaction((tx) => {
    const item = tx.select({ userId: items.userId }).from(items).where(eq(items.id, itemId)).get()
    if (!item) throw new DomainError('not_found')
    if (item.userId === authorId) throw new DomainError('forbidden')
    return tx.insert(notes).values({ itemId, userId: authorId, body }).returning({ id: notes.id }).get()
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
