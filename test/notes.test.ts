import { describe, expect, it } from 'vitest'
import { listBuyerItems } from '../server/domain/buyer-list'
import { addNote, deleteNote } from '../server/domain/notes'
import { addItem, addUser, codeOf, makeDb } from './helpers'

function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const item = addItem(db, art.id, 'Boek')
  const notesFor = (viewerId: number) => listBuyerItems(db, art.id, viewerId)[0]!.notes
  return { db, art, mom, sis, item, notesFor }
}

describe('notes between buyers', () => {
  it('shows a note to the other buyers, with who wrote it', () => {
    const { db, mom, sis, item, notesFor } = setup()
    addNote(db, item.id, mom.id, 'Ik heb de blauwe gekocht.')
    expect(notesFor(sis.id)).toMatchObject([{ author: 'Mom', body: 'Ik heb de blauwe gekocht.', mine: false }])
    expect(notesFor(mom.id)[0]!.mine).toBe(true)
  })

  it('refuses a note from the owner of the list', () => {
    const { db, art, item } = setup()
    expect(codeOf(() => addNote(db, item.id, art.id, 'Wat kopen jullie?'))).toBe('forbidden')
  })

  it('finds nothing for a note on a wish that does not exist', () => {
    const { db, mom } = setup()
    expect(codeOf(() => addNote(db, 9999, mom.id, 'x'))).toBe('not_found')
  })

  it('lets the author delete their note', () => {
    const { db, mom, sis, item, notesFor } = setup()
    const note = addNote(db, item.id, mom.id, 'Oeps')
    deleteNote(db, note.id, mom.id)
    expect(notesFor(sis.id)).toEqual([])
  })

  it('answers "not found" to anyone else, so the owner cannot probe for notes', () => {
    const { db, art, mom, sis, item, notesFor } = setup()
    const note = addNote(db, item.id, mom.id, 'Geheim')
    expect(codeOf(() => deleteNote(db, note.id, art.id))).toBe('not_found')
    expect(codeOf(() => deleteNote(db, note.id, sis.id))).toBe('not_found')
    expect(codeOf(() => deleteNote(db, 'no-such-note', art.id))).toBe('not_found')
    expect(notesFor(sis.id)).toHaveLength(1)
  })
})
