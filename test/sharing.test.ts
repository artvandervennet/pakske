import { readFileSync } from 'node:fs'
import { count, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notices, wishLinks, wishes } from '../server/db/schema'
import { getListView } from '../server/domain/list-view'
import { createList, deleteList, listMyLists, ownedListId } from '../server/domain/lists'
import { addNote } from '../server/domain/notes'
import { addNotice, countUnseen, listNotices, markNoticesSeen } from '../server/domain/notices'
import { setPurchase } from '../server/domain/purchases'
import { copyWish, linkWish } from '../server/domain/sharing'
import { updateDisplayName } from '../server/domain/users'
import { addWish, deleteWish, setWishImage, updateWish } from '../server/domain/wishes'
import { wishInput } from '../shared/schemas/input'
import { addList, addOwner, addUser, addWishTo, codeOf, expectOwnersSettled, makeDb, ownerIds, purchaseRows, titles, wishIn } from './helpers'

// A clock that only moves when a test moves it, so "most recent" never depends on two actions
// falling in the same millisecond.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())
const later = () => vi.setSystemTime(new Date(Date.now() + 1000))

function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lot = addUser(db, 'lot')
  const mom = addUser(db, 'mom')
  const A = addList(db, art.id)
  const game = addWishTo(db, art.id, A, 'Bordspel')
  const L = addList(db, lot.id, 'Lijst van Lotte')
  return { db, art, lot, mom, A, game, L }
}

const noticeRows = (db: ReturnType<typeof makeDb>) => db.select({ n: count() }).from(notices).get()!.n

describe('linking a wish', () => {
  it('makes the linker an owner at once, of the same wish, and tells the earlier owner', () => {
    const { db, art, lot, A, game, L } = setup()
    setPurchase(db, A, game.id, lot.id, 1) // already bought: allowed
    expect(linkWish(db, lot.id, A, game.id, { list: L })).toEqual({ token: L, title: 'Lijst van Lotte', wishId: game.id })
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
    expect(wishIn(getListView(db, L, lot.id), game.id)).toMatchObject({ role: 'owner', mine: 1 })
    expect(wishIn(getListView(db, A, lot.id), game.id)).toMatchObject({ role: 'owner', mine: 1 })
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'wish_linked', actor: 'Lot', actorId: lot.id, title: 'Bordspel', token: A, wishId: game.id, canUndo: true, fresh: true }])
    expect(listNotices(db, lot.id)).toEqual([])
    expect(db.select().from(wishLinks).all()).toMatchObject([{ wishId: game.id, userId: lot.id }])
    expectOwnersSettled(db)
  })

  it('tells every earlier owner, and only them', () => {
    const { db, art, lot, mom, A, game, L } = setup()
    const sis = addUser(db, 'sis')
    addOwner(db, A, sis.id)
    addOwner(db, L, mom.id) // comes with Lotte's list, so she wasn't an owner before
    linkWish(db, lot.id, A, game.id, { list: L })
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id, mom.id, sis.id])
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'wish_linked', actorId: lot.id }])
    expect(listNotices(db, sis.id)).toMatchObject([{ kind: 'wish_linked', actorId: lot.id, token: A }])
    expect(listNotices(db, mom.id)).toEqual([])
    expect(listNotices(db, lot.id)).toEqual([])
    expectOwnersSettled(db)
  })
})

describe('copying a wish', () => {
  it('copies a wish into a separate one and tells nobody', () => {
    const { db, art, lot, mom, A, L } = setup()
    const vase = addWish(db, art.id, A, wishInput.parse({ title: 'Vaas', description: 'Blauw', url: 'https://example.test/vaas', quantity: 3 }))
    setWishImage(db, art.id, A, vase.id, 'vaas.png')
    setPurchase(db, A, vase.id, mom.id, 2)

    const landed = copyWish(db, lot.id, A, vase.id, { list: L })
    expect(landed).toMatchObject({ token: L, title: 'Lijst van Lotte' })
    expect(landed.wishId).not.toBe(vase.id)
    const copy = db.select().from(wishes).where(eq(wishes.id, landed.wishId)).get()!
    expect(copy).toMatchObject({ title: 'Vaas', description: 'Blauw', url: 'https://example.test/vaas', imageFile: 'vaas.png', quantity: 3, deletedAt: null })
    expect(ownerIds(db, copy.id)).toEqual([lot.id])
    expect(ownerIds(db, vase.id)).toEqual([art.id])
    expect(purchaseRows(db, copy.id)).toEqual([])
    expect(noticeRows(db)).toBe(0)
    expect(db.select().from(wishLinks).all()).toEqual([])

    updateWish(db, lot.id, L, copy.id, { title: 'Groene vaas', quantity: 1 })
    expect(wishIn(getListView(db, A, art.id), vase.id)).toMatchObject({ title: 'Vaas', quantity: 3, image: '/uploads/vaas.png' })
    expect(wishIn(getListView(db, L, lot.id), copy.id)).toMatchObject({ title: 'Groene vaas', quantity: 1, mine: 0 })
    expectOwnersSettled(db)
  })
})

describe('what can be linked or copied', () => {
  it('refuses someone who already owns the wish', () => {
    const { db, art, lot, A, game, L } = setup()
    const art2 = addList(db, art.id, 'Verjaardag')
    expect(codeOf(() => linkWish(db, art.id, A, game.id, { list: art2 }))).toBe('forbidden')
    expect(codeOf(() => copyWish(db, art.id, A, game.id, { list: art2 }))).toBe('forbidden')
    linkWish(db, lot.id, A, game.id, { list: L })
    const lot2 = addList(db, lot.id, 'Nog een')
    expect(codeOf(() => linkWish(db, lot.id, A, game.id, { list: lot2 }))).toBe('forbidden')
    expect(codeOf(() => copyWish(db, lot.id, L, game.id, { list: lot2 }))).toBe('forbidden')
    expect(titles(getListView(db, art2, art.id))).toEqual([])
    expect(titles(getListView(db, lot2, lot.id))).toEqual([])
    expect(listNotices(db, art.id)).toHaveLength(1)
  })

  it('finds nothing through a list that does not show the wish, or for a target that is not theirs', () => {
    const { db, art, lot, mom, A, game, L } = setup()
    const M = addList(db, mom.id, 'Moederdag')
    const other = addWishTo(db, art.id, addList(db, art.id, 'Verjaardag'), 'Sokken')
    for (const add of [linkWish, copyWish]) {
      expect(codeOf(() => add(db, lot.id, A, other.id, { list: L }))).toBe('not_found')
      expect(codeOf(() => add(db, lot.id, M, game.id, { list: L }))).toBe('not_found')
      expect(codeOf(() => add(db, lot.id, 'no-such-list-token-00', game.id, { list: L }))).toBe('not_found')
      expect(codeOf(() => add(db, lot.id, A, game.id, { list: M }))).toBe('not_found')
      expect(codeOf(() => add(db, lot.id, A, game.id, { list: 'no-such-list-token-00' }))).toBe('not_found')
    }
    expect(ownerIds(db, game.id)).toEqual([art.id])
    expect(titles(getListView(db, M, mom.id))).toEqual([])
    expect(noticeRows(db)).toBe(0)
  })

  it('does not link or copy a wish that was taken off', () => {
    const { db, art, lot, mom, A, game, L } = setup()
    // A joint wish taken off one list still lives on the other, but not through the list it left.
    const lamp = addWishTo(db, art.id, A, 'Lamp')
    const M = addList(db, mom.id, 'Moederdag')
    linkWish(db, mom.id, A, lamp.id, { list: M })
    deleteWish(db, art.id, A, lamp.id)
    deleteWish(db, art.id, A, game.id)
    for (const add of [linkWish, copyWish]) {
      expect(codeOf(() => add(db, lot.id, A, game.id, { list: L }))).toBe('wish_removed')
      expect(codeOf(() => add(db, lot.id, A, lamp.id, { list: L }))).toBe('wish_removed')
    }
    expect(titles(getListView(db, L, lot.id))).toEqual([])
    expect(linkWish(db, lot.id, M, lamp.id, { list: L })).toMatchObject({ token: L, wishId: lamp.id })
  })

  it('can land on a new list', () => {
    const { db, lot, A, game } = setup()
    const linked = linkWish(db, lot.id, A, game.id, { newList: 'Samen' })
    expect(linked).toMatchObject({ title: 'Samen', wishId: game.id })
    expect(() => ownedListId(db, lot.id, linked.token)).not.toThrow()
    expect(wishIn(getListView(db, linked.token, lot.id), game.id)).toMatchObject({ role: 'owner', title: 'Bordspel' })

    const copied = copyWish(db, addUser(db, 'sis').id, A, game.id, { newList: 'Van zus' })
    expect(copied.title).toBe('Van zus')
    expect(titles(getListView(db, copied.token, null))).toEqual(['Bordspel'])
    expectOwnersSettled(db)
  })

  it('refuses when the target list is full, or the person has 50 lists', () => {
    const { db, art, lot, A, game, L } = setup()
    for (let i = 0; i < 200; i++) addWishTo(db, lot.id, L, `Wens ${i}`)
    expect(codeOf(() => linkWish(db, lot.id, A, game.id, { list: L }))).toBe('wish_limit')
    expect(codeOf(() => copyWish(db, lot.id, A, game.id, { list: L }))).toBe('wish_limit')

    for (let i = 1; i < 50; i++) addList(db, lot.id, `Lijst ${i}`)
    expect(codeOf(() => linkWish(db, lot.id, A, game.id, { newList: 'Te veel' }))).toBe('list_limit')
    expect(codeOf(() => copyWish(db, lot.id, A, game.id, { newList: 'Te veel' }))).toBe('list_limit')

    // Nothing of a refused attempt stays behind.
    expect(ownerIds(db, game.id)).toEqual([art.id])
    expect(listMyLists(db, lot.id).lists).toHaveLength(50)
    expect(db.select({ n: count() }).from(wishes).get()!.n).toBe(201)
    expect(noticeRows(db)).toBe(0)
    expect(db.select().from(wishLinks).all()).toEqual([])
  })

  it('refuses a new list once the person has made 200', () => {
    const { db, lot, A, game } = setup()
    for (let i = 1; i < 200; i++) deleteList(db, lot.id, createList(db, lot.id, `Lijst ${i}`).token)
    expect(codeOf(() => linkWish(db, lot.id, A, game.id, { newList: 'Nog een' }))).toBe('list_limit_ever')
    expect(codeOf(() => copyWish(db, lot.id, A, game.id, { newList: 'Nog een' }))).toBe('list_limit_ever')
  })
})

describe('the lists to choose from', () => {
  it('remembers which list was used last', () => {
    const { db, art, lot, A, game, L } = setup()
    expect(listMyLists(db, lot.id)).toEqual({ lists: [{ token: L, title: 'Lijst van Lotte' }], last: null })
    const lamp = addWishTo(db, art.id, A, 'Lamp')
    later()
    const L2 = addList(db, lot.id, 'Verjaardag')
    linkWish(db, lot.id, A, game.id, { list: L2 })
    expect(listMyLists(db, lot.id).last).toBe(L2)
    later()
    copyWish(db, lot.id, A, lamp.id, { list: L })
    expect(listMyLists(db, lot.id)).toEqual({
      lists: [{ token: L, title: 'Lijst van Lotte' }, { token: L2, title: 'Verjaardag' }],
      last: L,
    })
  })

  it('leaves out lists that are deleted or someone else\'s', () => {
    const { db, art, lot, A, game, L } = setup()
    const L2 = addList(db, lot.id, 'Verjaardag')
    later()
    linkWish(db, lot.id, A, game.id, { list: L2 })
    deleteList(db, lot.id, L2)
    expect(listMyLists(db, lot.id)).toEqual({ lists: [{ token: L, title: 'Lijst van Lotte' }], last: null })
    expect(listMyLists(db, art.id)).toEqual({ lists: [{ token: A, title: 'Kerst' }], last: A })
  })
})

describe('notices', () => {
  it('marks notices as seen', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    expect(countUnseen(db, art.id)).toBe(1)
    expect(countUnseen(db, lot.id)).toBe(0)
    markNoticesSeen(db, art.id)
    expect(countUnseen(db, art.id)).toBe(0)
    expect(listNotices(db, art.id)).toMatchObject([{ fresh: false }])
  })

  it('shows the actor\'s name as it is now and the title as it was', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    updateDisplayName(db, lot.id, 'Lotte')
    updateWish(db, art.id, A, game.id, { title: 'Kaartspel' })
    expect(listNotices(db, art.id)).toMatchObject([{ actor: 'Lotte', actorId: lot.id, title: 'Bordspel' }])
  })

  it('puts the newest first, by time and then by the order they were made', () => {
    const { db, art, lot, mom, A, game, L } = setup()
    const lamp = addWishTo(db, art.id, A, 'Lamp')
    const vase = addWishTo(db, art.id, A, 'Vaas')
    linkWish(db, lot.id, A, game.id, { list: L })
    later()
    linkWish(db, lot.id, A, lamp.id, { list: L })
    linkWish(db, mom.id, A, vase.id, { newList: 'Moederdag' })
    expect(listNotices(db, art.id).map(notice => notice.title)).toEqual(['Vaas', 'Lamp', 'Bordspel'])
    expect(new Set(listNotices(db, art.id).map(notice => notice.id)).size).toBe(3)
  })

  it('points to no list and offers no undo once the wish is no longer on one of the recipient\'s', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    deleteWish(db, art.id, A, game.id)
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'wish_linked', token: null, wishId: game.id, canUndo: false }])
  })

  it('offers no undo once the link is forgotten', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    db.delete(wishLinks).run()
    expect(listNotices(db, art.id)).toMatchObject([{ token: A, canUndo: false }])
  })

  it('points to the notice\'s own list while the recipient still owns it', () => {
    const { db, art, lot, A } = setup()
    addNotice(db, { userId: art.id, kind: 'list_joined', actorId: lot.id, title: 'Kerst', listId: ownedListId(db, art.id, A) })
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'list_joined', actor: 'Lot', title: 'Kerst', more: 0, token: A, wishId: null, canUndo: false, fresh: true }])
    deleteList(db, art.id, A)
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'list_joined', token: null }])
  })

  it('leaves no notice for buying or writing', () => {
    const { db, art, mom, A } = setup()
    const puzzles = addWishTo(db, art.id, A, 'Puzzels', null)
    setPurchase(db, A, puzzles.id, mom.id, 1)
    setPurchase(db, A, puzzles.id, art.id, 1)
    addNote(db, A, puzzles.id, mom.id, 'Ik heb er al een')
    expect(noticeRows(db)).toBe(0)
  })

  it.each(['sharing.ts', 'notices.ts'])('server/domain/%s never touches purchases or notes', (file) => {
    expect(readFileSync(`server/domain/${file}`, 'utf8')).not.toMatch(/purchases|notes/i)
  })
})
