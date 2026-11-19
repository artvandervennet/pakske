import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { notes } from '../server/db/schema'
import { addNote, deleteNote } from '../server/domain/notes'
import { setPurchase } from '../server/domain/purchases'
import { deleteWish } from '../server/domain/wishes'
import { addList, addUser, addWishTo, codeOf, makeDb } from './helpers'

function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const token = addList(db, art.id)
  const wish = addWishTo(db, art.id, token, 'Boek')
  const noteRows = () => db.select({ userId: notes.userId, body: notes.body }).from(notes).where(eq(notes.wishId, wish.id)).all()
  return { db, art, mom, sis, token, wish, noteRows }
}

describe('notes between buyers', () => {
  it('stores a buyer\'s note with who wrote it', () => {
    const { db, token, wish, mom, noteRows } = setup()
    const note = addNote(db, token, wish.id, mom.id, 'Ik heb de blauwe gekocht.')
    expect(note.id).toEqual(expect.any(String))
    expect(noteRows()).toEqual([{ userId: mom.id, body: 'Ik heb de blauwe gekocht.' }])
  })

  it('refuses a note from an owner of the wish', () => {
    const { db, token, wish, art, noteRows } = setup()
    expect(codeOf(() => addNote(db, token, wish.id, art.id, 'Wat kopen jullie?'))).toBe('forbidden')
    expect(noteRows()).toEqual([])
  })

  it('finds nothing for a wish that is not on that list, or a token that matches no list', () => {
    const { db, token, wish, art, mom } = setup()
    const other = addList(db, art.id, 'Verjaardag')
    expect(codeOf(() => addNote(db, other, wish.id, mom.id, 'x'))).toBe('not_found')
    expect(codeOf(() => addNote(db, 'no-such-token', wish.id, mom.id, 'x'))).toBe('not_found')
    expect(codeOf(() => addNote(db, token, 9999, mom.id, 'x'))).toBe('not_found')
  })

  it('lets whoever bought a wish still write a note on it after the owner deleted it', () => {
    const { db, token, wish, art, mom, noteRows } = setup()
    setPurchase(db, token, wish.id, mom.id, 1)
    deleteWish(db, art.id, token, wish.id)
    addNote(db, token, wish.id, mom.id, 'Wie houdt hem?')
    expect(noteRows()).toEqual([{ userId: mom.id, body: 'Wie houdt hem?' }])
  })

  it('finds nothing for a deleted wish the person bought none of, whoever else did', () => {
    const { db, token, wish, art, mom, sis, noteRows } = setup()
    setPurchase(db, token, wish.id, mom.id, 1)
    deleteWish(db, art.id, token, wish.id)
    expect(codeOf(() => addNote(db, token, wish.id, sis.id, 'Wie houdt hem?'))).toBe('not_found')
    // The owner's answer stays the one it always is.
    expect(codeOf(() => addNote(db, token, wish.id, art.id, 'Wie houdt hem?'))).toBe('forbidden')
    expect(noteRows()).toEqual([])
  })

  it('refuses the 201st note on a wish', () => {
    const { db, token, wish, mom, sis, noteRows } = setup()
    for (let i = 0; i < 200; i++) addNote(db, token, wish.id, i % 2 ? mom.id : sis.id, `Notitie ${i}`)
    expect(codeOf(() => addNote(db, token, wish.id, mom.id, 'Te veel'))).toBe('note_limit')
    expect(noteRows()).toHaveLength(200)
  })

  it('gives an owner the same refusal whether or not the wish has room for notes', () => {
    const { db, token, wish, art, mom } = setup()
    for (let i = 0; i < 200; i++) addNote(db, token, wish.id, mom.id, `Notitie ${i}`)
    expect(codeOf(() => addNote(db, token, wish.id, art.id, 'Hoeveel?'))).toBe('forbidden')
  })

  it('refuses a note from the list\'s owner on a wish they deleted, with room for notes or not', () => {
    for (const full of [false, true]) {
      const { db, token, wish, art, mom, noteRows } = setup()
      setPurchase(db, token, wish.id, mom.id, 1)
      if (full) for (let i = 0; i < 200; i++) addNote(db, token, wish.id, mom.id, `Notitie ${i}`)
      deleteWish(db, art.id, token, wish.id)
      // Art no longer owns the wish, but it was his list's: he must not learn whether notes exist.
      expect(codeOf(() => addNote(db, token, wish.id, art.id, 'Hoeveel?'))).toBe('forbidden')
      expect(noteRows()).toHaveLength(full ? 200 : 0)
    }
  })

  it('lets the author delete their note', () => {
    const { db, token, wish, mom, noteRows } = setup()
    const note = addNote(db, token, wish.id, mom.id, 'Oeps')
    deleteNote(db, note.id, mom.id)
    expect(noteRows()).toEqual([])
  })

  it('answers "not found" to anyone else, so an owner cannot probe for notes', () => {
    const { db, token, wish, art, mom, sis, noteRows } = setup()
    const note = addNote(db, token, wish.id, mom.id, 'Geheim')
    expect(codeOf(() => deleteNote(db, note.id, art.id))).toBe('not_found')
    expect(codeOf(() => deleteNote(db, note.id, sis.id))).toBe('not_found')
    expect(codeOf(() => deleteNote(db, 'no-such-note', art.id))).toBe('not_found')
    expect(noteRows()).toHaveLength(1)
  })
})
