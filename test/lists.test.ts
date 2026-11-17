import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { listWishes, wishes } from '../server/db/schema'
import { getListView } from '../server/domain/list-view'
import { createList, deleteList, leaveList, listOwnedLists, ownedListId, renameList } from '../server/domain/lists'
import { putOnList } from '../server/domain/placement'
import { LIST_TOKEN } from '../server/domain/tokens'
import { deleteWish } from '../server/domain/wishes'
import { addList, addOwner, addUser, addWishTo, codeOf, expectOwnersSettled, makeDb, ownerIds, titles } from './helpers'

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
      { token: kerst, title: 'Kerst', wishes: 0, sharedWith: [] },
      { token: verjaardag, title: 'Verjaardag', wishes: 2, sharedWith: [] },
    ])
  })

  it('renames a list and keeps its address', () => {
    const { db, art } = setup()
    const token = addList(db, art.id)
    renameList(db, art.id, token, 'Sinterklaas')
    expect(listOwnedLists(db, art.id)).toEqual([{ token, title: 'Sinterklaas', wishes: 0, sharedWith: [] }])
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

  it('leaves a joint wish on the other list, owned by that list\'s owners', () => {
    const { db, art } = setup()
    const lot = addUser(db, 'lotte')
    const mine = addList(db, art.id, 'Kerst')
    const theirs = addList(db, lot.id, 'Verjaardag')
    const joint = addWishTo(db, art.id, mine, 'Bordspel')
    const own = addWishTo(db, art.id, mine, 'Sokken')
    putOnList(db, ownedListId(db, lot.id, theirs), joint.id)

    deleteList(db, art.id, mine)
    expect(ownerIds(db, joint.id)).toEqual([lot.id])
    expect(db.select().from(wishes).where(eq(wishes.id, joint.id)).get()?.deletedAt).toBeNull()
    expect(db.select().from(wishes).where(eq(wishes.id, own.id)).get()?.deletedAt).toBeInstanceOf(Date)
    expect(titles(getListView(db, theirs, lot.id))).toEqual(['Bordspel'])
    expect(listOwnedLists(db, lot.id)).toEqual([{ token: theirs, title: 'Verjaardag', wishes: 1, sharedWith: [] }])
    expectOwnersSettled(db)
  })

  it('counts only the wishes that are on the list now', () => {
    const { db, art } = setup()
    const lot = addUser(db, 'lotte')
    const mine = addList(db, art.id, 'Kerst')
    const theirs = addList(db, lot.id, 'Verjaardag')
    const joint = addWishTo(db, art.id, mine, 'Bordspel')
    putOnList(db, ownedListId(db, lot.id, theirs), joint.id)
    deleteWish(db, art.id, mine, joint.id)
    // The wish lives on, on Lotte's list; Art's list no longer shows it.
    expect(listOwnedLists(db, art.id)).toEqual([{ token: mine, title: 'Kerst', wishes: 0, sharedWith: [] }])
    expect(listOwnedLists(db, lot.id)).toEqual([{ token: theirs, title: 'Verjaardag', wishes: 1, sharedWith: [] }])
  })

  it('names the other owners of a list, in the order they joined', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
      const { db, art, mom } = setup()
      const ann = addUser(db, 'ann')
      const token = addList(db, art.id)
      vi.setSystemTime(new Date('2026-12-01T11:00:00Z'))
      addOwner(db, token, mom.id)
      vi.setSystemTime(new Date('2026-12-01T12:00:00Z'))
      addOwner(db, token, ann.id)
      expect(listOwnedLists(db, art.id)[0]!.sharedWith).toEqual(['Mom', 'Ann'])
      expect(listOwnedLists(db, mom.id)[0]!.sharedWith).toEqual(['Art', 'Ann'])
      expect(listOwnedLists(db, ann.id)[0]!.sharedWith).toEqual(['Art', 'Mom'])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('lets only an owner leave, and refuses to delete a list someone else owns too', () => {
    const { db, art, mom } = setup()
    const token = addList(db, art.id)
    expect(codeOf(() => leaveList(db, mom.id, token))).toBe('not_found')
    addOwner(db, token, mom.id)
    expect(codeOf(() => deleteList(db, art.id, token))).toBe('list_shared')
    leaveList(db, art.id, token)
    expect(listOwnedLists(db, art.id)).toEqual([])
    expect(listOwnedLists(db, mom.id)).toEqual([{ token, title: 'Kerst', wishes: 0, sharedWith: [] }])
    expect(codeOf(() => leaveList(db, mom.id, token))).toBe('last_owner')
    deleteList(db, mom.id, token)
    expect(listOwnedLists(db, mom.id)).toEqual([])
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
