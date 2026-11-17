import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { listWishes, wishes } from '../server/db/schema'
import { createList, deleteList, listOwnedLists, ownedListId, renameList } from '../server/domain/lists'
import { LIST_TOKEN } from '../server/domain/tokens'
import { addList, addUser, codeOf, makeDb } from './helpers'

function setup() {
  const db = makeDb()
  return { db, art: addUser(db, 'art'), mom: addUser(db, 'mom') }
}

describe('lists', () => {
  it('makes a list with an address nobody chose', () => {
    const { db, art } = setup()
    const { token, title } = createList(db, art.id, 'Kerst')
    expect(title).toBe('Kerst')
    expect(token).toMatch(LIST_TOKEN)
    expect(createList(db, art.id, 'Kerst').token).not.toBe(token)
  })

  it('shows a person their own lists, oldest first, with how many wishes each has', () => {
    const { db, art, mom } = setup()
    const kerst = addList(db, art.id, 'Kerst')
    const verjaardag = addList(db, art.id, 'Verjaardag')
    addList(db, mom.id, 'Moederdag')
    const wish = (title: string, deletedAt: Date | null) => db.insert(wishes).values({ title, deletedAt }).returning().get().id
    for (const id of [wish('Boek', null), wish('Lamp', null), wish('Weg', new Date())]) {
      db.insert(listWishes).values({ listId: ownedListId(db, art.id, verjaardag), wishId: id }).run()
    }
    expect(listOwnedLists(db, art.id)).toEqual([
      { token: kerst, title: 'Kerst', wishes: 0 },
      { token: verjaardag, title: 'Verjaardag', wishes: 2 },
    ])
  })

  it('renames a list and keeps its address', () => {
    const { db, art } = setup()
    const token = addList(db, art.id)
    renameList(db, art.id, token, 'Sinterklaas')
    expect(listOwnedLists(db, art.id)).toEqual([{ token, title: 'Sinterklaas', wishes: 0 }])
  })

  it('does not let someone else rename or delete it', () => {
    const { db, art, mom } = setup()
    const token = addList(db, art.id)
    expect(codeOf(() => renameList(db, mom.id, token, 'Mine'))).toBe('not_found')
    expect(codeOf(() => deleteList(db, mom.id, token))).toBe('not_found')
    expect(listOwnedLists(db, art.id)).toHaveLength(1)
  })

  it('takes a deleted list off the owner\'s lists, and a second delete finds nothing', () => {
    const { db, art } = setup()
    const token = addList(db, art.id)
    deleteList(db, art.id, token)
    expect(listOwnedLists(db, art.id)).toEqual([])
    expect(codeOf(() => deleteList(db, art.id, token))).toBe('not_found')
  })

  it('deletes the wishes shown on the list along with it', () => {
    const { db, art } = setup()
    const token = addList(db, art.id)
    const wish = db.insert(wishes).values({ title: 'Boek' }).returning().get()
    db.insert(listWishes).values({ listId: ownedListId(db, art.id, token), wishId: wish.id }).run()
    deleteList(db, art.id, token)
    expect(db.select().from(wishes).where(eq(wishes.id, wish.id)).get()?.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses a 51st list', () => {
    const { db, art } = setup()
    for (let i = 0; i < 50; i++) addList(db, art.id, `Lijst ${i}`)
    expect(codeOf(() => createList(db, art.id, 'Te veel'))).toBe('list_limit')
  })

  it('refuses a list once the person has made 200, deleted or not', () => {
    const { db, art, mom } = setup()
    for (let i = 0; i < 200; i++) deleteList(db, art.id, addList(db, art.id, `Lijst ${i}`))
    expect(codeOf(() => createList(db, art.id, 'Nog een'))).toBe('list_limit_ever')
    // Someone else's lists don't count.
    expect(codeOf(() => createList(db, mom.id, 'Moederdag'))).toBeUndefined()
  })
})
