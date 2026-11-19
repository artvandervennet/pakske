import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listWishes, wishes } from '../server/db/schema'
import { getListView } from '../server/domain/list-view'
import { createList, deleteList, leaveList, listOwnedLists, ownedListId, relinkList, renameList } from '../server/domain/lists'
import { listNotices } from '../server/domain/notices'
import { putOnList } from '../server/domain/placement'
import { LIST_TOKEN } from '../server/domain/tokens'
import { forgetList, listOpenedLists, rememberList } from '../server/domain/visits'
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

  it('shows a person their own lists with how many wishes each has', () => {
    const { db, art, mom } = setup()
    const kerst = addList(db, art.id, 'Kerst')
    const verjaardag = addList(db, art.id, 'Verjaardag')
    addList(db, mom.id, 'Moederdag')
    const wish = (title: string, deletedAt: Date | null) => db.insert(wishes).values({ title, deletedAt }).returning().get().id
    for (const id of [wish('Boek', null), wish('Lamp', null), wish('Weg', new Date())]) {
      db.insert(listWishes).values({ listId: ownedListId(db, art.id, verjaardag), wishId: id }).run()
    }
    expect(listOwnedLists(db, art.id)).toEqual([
      { token: verjaardag, title: 'Verjaardag', wishes: 2, owners: ['Art'], sharedWith: [] },
      { token: kerst, title: 'Kerst', wishes: 0, owners: ['Art'], sharedWith: [] },
    ])
  })

  it('renames a list and keeps its address', () => {
    const { db, art } = setup()
    const token = addList(db, art.id)
    renameList(db, art.id, token, 'Sinterklaas')
    expect(listOwnedLists(db, art.id)).toEqual([{ token, title: 'Sinterklaas', wishes: 0, owners: ['Art'], sharedWith: [] }])
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
    expect(listOwnedLists(db, lot.id)).toEqual([{ token: theirs, title: 'Verjaardag', wishes: 1, owners: ['Lotte'], sharedWith: [] }])
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
    expect(listOwnedLists(db, art.id)).toEqual([{ token: mine, title: 'Kerst', wishes: 0, owners: ['Art'], sharedWith: [] }])
    expect(listOwnedLists(db, lot.id)).toEqual([{ token: theirs, title: 'Verjaardag', wishes: 1, owners: ['Lotte'], sharedWith: [] }])
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
      // Every owner by name, the person too, so a search on a name finds the list.
      for (const who of [art, mom, ann]) expect(listOwnedLists(db, who.id)[0]!.owners).toEqual(['Art', 'Mom', 'Ann'])
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
    expect(listOwnedLists(db, mom.id)).toEqual([{ token, title: 'Kerst', wishes: 0, owners: ['Mom'], sharedWith: [] }])
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

describe('the order of a person\'s own lists', () => {
  let db: ReturnType<typeof makeDb>
  let art: number
  let mom: number

  beforeEach(() => {
    // The order is decided by timestamps, so the clock has to move between the steps.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
    db = makeDb()
    art = addUser(db, 'art').id
    mom = addUser(db, 'mom').id
  })
  afterEach(() => vi.useRealTimers())

  const later = () => vi.setSystemTime(new Date(Date.now() + 1000))
  const order = (userId: number) => listOwnedLists(db, userId).map(list => list.title)

  it('puts the newest list first while none has been opened', () => {
    addList(db, art, 'Kerst')
    later()
    addList(db, art, 'Verjaardag')
    later()
    addList(db, art, 'Sinterklaas')
    expect(order(art)).toEqual(['Sinterklaas', 'Verjaardag', 'Kerst'])
  })

  it('moves a list to the front when its owner opens it', () => {
    const kerst = addList(db, art, 'Kerst')
    later()
    addList(db, art, 'Verjaardag')
    later()
    rememberList(db, art, kerst)
    expect(order(art)).toEqual(['Kerst', 'Verjaardag'])
    later()
    addList(db, art, 'Sinterklaas')
    expect(order(art)).toEqual(['Sinterklaas', 'Kerst', 'Verjaardag'])
  })

  it('puts the newer list first when two have the same moment', () => {
    addList(db, art, 'Kerst')
    addList(db, art, 'Verjaardag')
    expect(order(art)).toEqual(['Verjaardag', 'Kerst'])
  })

  it('counts a list from the moment the person became an owner, also when they opened it before', () => {
    const kerst = addList(db, mom, 'Kerst')
    rememberList(db, art, kerst)
    later()
    addList(db, art, 'Verjaardag')
    later()
    addOwner(db, kerst, art)
    expect(order(art)).toEqual(['Kerst', 'Verjaardag'])
    // For Mom nothing moved: she made Kerst before Art made anything.
    expect(order(mom)).toEqual(['Kerst'])
  })

  it('goes by the person\'s own visits, not by anyone else\'s', () => {
    const kerst = addList(db, art, 'Kerst')
    later()
    addList(db, art, 'Verjaardag')
    later()
    addOwner(db, kerst, mom)
    later()
    rememberList(db, mom, kerst)
    rememberList(db, addUser(db, 'sis').id, kerst)
    expect(order(art)).toEqual(['Verjaardag', 'Kerst'])
  })

  it('keeps the order when the person tries to forget a list of their own', () => {
    const kerst = addList(db, art, 'Kerst')
    later()
    addList(db, art, 'Verjaardag')
    later()
    rememberList(db, art, kerst)
    forgetList(db, art, kerst)
    expect(order(art)).toEqual(['Kerst', 'Verjaardag'])
  })
})

describe('a new link for a list', () => {
  it('gives the list another address and keeps everything on it', () => {
    const { db, art } = setup()
    const old = addList(db, art.id, 'Kerst')
    addWishTo(db, art.id, old, 'Sokken')
    const { token } = relinkList(db, art.id, old)
    expect(token).toMatch(LIST_TOKEN)
    expect(token).not.toBe(old)
    expect(titles(getListView(db, token, art.id))).toEqual(['Sokken'])
    expect(getListView(db, old, null)).toBeUndefined()
    expect(listOwnedLists(db, art.id).map(list => list.token)).toEqual([token])
  })

  it('is only for an owner of a live list', () => {
    const { db, art, mom } = setup()
    const token = addList(db, art.id)
    expect(codeOf(() => relinkList(db, mom.id, token))).toBe('not_found')
    deleteList(db, art.id, token)
    expect(codeOf(() => relinkList(db, art.id, token))).toBe('not_found')
  })

  it('takes the list off the visited lists of everyone who does not own it, and tells the other owners', () => {
    const { db, art, mom } = setup()
    const sis = addUser(db, 'sis')
    const old = addList(db, art.id, 'Kerst')
    addOwner(db, old, sis.id)
    rememberList(db, mom.id, old)
    rememberList(db, sis.id, old)
    const { token } = relinkList(db, art.id, old)
    expect(listOpenedLists(db, mom.id)).toEqual([])
    expect(listOwnedLists(db, sis.id).map(list => list.token)).toEqual([token])
    expect(listNotices(db, sis.id)).toMatchObject([{ kind: 'list_relinked', actor: 'Art', title: 'Kerst', token }])
    expect(listNotices(db, art.id)).toEqual([])
  })

  it('can be done again, and no earlier address comes back', () => {
    const { db, art } = setup()
    const first = addList(db, art.id, 'Kerst')
    const second = relinkList(db, art.id, first).token
    const third = relinkList(db, art.id, second).token
    expect(new Set([first, second, third]).size).toBe(3)
    expect(getListView(db, first, null)).toBeUndefined()
    expect(getListView(db, second, null)).toBeUndefined()
    expect(getListView(db, third, null)).toMatchObject({ title: 'Kerst' })
  })

  it('never reads what buyers did', () => {
    expect(readFileSync('server/domain/lists.ts', 'utf8')).not.toMatch(/purchases|notes/i)
  })
})

