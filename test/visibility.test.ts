import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getListView } from '../server/domain/list-view'
import { deleteList } from '../server/domain/lists'
import { addNote } from '../server/domain/notes'
import { setPurchase } from '../server/domain/purchases'
import { deleteWish, updateWish } from '../server/domain/wishes'
import { wishInput } from '../shared/schemas/input'
import { anonWishSchema, buyerWishSchema, ownerWishSchema, type ListView } from '../shared/schemas/list'
import { addList, addUser, addWishTo, codeOf, makeDb } from './helpers'

// Both worlds get the same address, so their views can be compared whole.
vi.mock('../server/domain/tokens', async importOriginal => ({
  ...await importOriginal<typeof import('../server/domain/tokens')>(),
  newListToken: () => 'kerst-kerst-kerst-kers',
}))

// One clock for every database, so two of them built the same way are equal to the millisecond.
const START = new Date('2026-12-01T10:00:00Z')
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})
afterEach(() => vi.useRealTimers())

/**
 * Art's list with four wishes. With `buyersActive`, mom and sis buy three of them and write
 * notes; that is the only difference between the two worlds. Afterwards, in both, Art lowers the
 * amount of the book below what sis bought and deletes the socks, which mom had bought.
 * Nobody ever buys the puzzles.
 */
function world(buyersActive: boolean) {
  const db = makeDb()
  const art = addUser(db, 'art')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const token = addList(db, art.id)
  const plugs = addWishTo(db, art.id, token, 'Slimme stekkers', 3)
  const puzzles = addWishTo(db, art.id, token, 'Puzzels', null)
  const book = addWishTo(db, art.id, token, 'Boek', 2)
  const socks = addWishTo(db, art.id, token, 'Sokken', 1)

  if (buyersActive) {
    vi.advanceTimersByTime(60_000)
    setPurchase(db, token, plugs.id, mom.id, 1)
    setPurchase(db, token, plugs.id, sis.id, 1)
    setPurchase(db, token, book.id, sis.id, 2)
    setPurchase(db, token, socks.id, mom.id, 1)
    addNote(db, token, plugs.id, mom.id, 'Ik neem er een.')
    addNote(db, token, socks.id, sis.id, 'Al gekocht!')
    vi.setSystemTime(START)
  }

  vi.advanceTimersByTime(3_600_000)
  updateWish(db, art.id, token, book.id, wishInput.parse({ title: 'Boek', quantity: 1 }))
  deleteWish(db, art.id, token, socks.id)
  vi.setSystemTime(START)

  return { db, token, art, mom, sis, plugs, puzzles, book, socks }
}

const titles = (view: ListView | undefined) => view!.wishes.map(wish => wish.title)
const wishIn = (view: ListView | undefined, id: number) => view!.wishes.find(wish => wish.id === id)

describe('the owner and visitors who are not logged in', () => {
  it('gives the owner and a logged-out visitor exactly the same list whether or not anyone bought or wrote', () => {
    const quiet = world(false)
    const busy = world(true)
    expect(getListView(busy.db, busy.token, busy.art.id)).toEqual(getListView(quiet.db, quiet.token, quiet.art.id))
    expect(getListView(busy.db, busy.token, null)).toEqual(getListView(quiet.db, quiet.token, null))
  })

  it('gives them wishes with no field about other people', () => {
    const { db, token, art } = world(true)
    const owner = getListView(db, token, art.id)!
    const anon = getListView(db, token, null)!
    expect(owner.wishes).toHaveLength(3)
    expect(anon.wishes).toHaveLength(3)
    for (const wish of owner.wishes) expect(() => ownerWishSchema.parse(wish)).not.toThrow()
    for (const wish of anon.wishes) expect(() => anonWishSchema.parse(wish)).not.toThrow()
    expect(owner).toMatchObject({ owners: ['Art'], viewerOwnsList: true, deleted: false })
    expect(anon).toMatchObject({ owners: ['Art'], viewerOwnsList: false, deleted: false })

    const json = JSON.stringify([owner, anon])
    for (const secret of ['Mom', 'Sis', 'Ik neem er een', 'Al gekocht', 'purchases', 'notes', 'bought', 'removed']) {
      expect(json).not.toContain(secret)
    }
  })

  it('shows an owner their own purchase and nothing else', () => {
    const quiet = world(false)
    const busy = world(true)
    const before = getListView(busy.db, busy.token, busy.art.id)!
    for (const { db, token, art, plugs } of [quiet, busy]) setPurchase(db, token, plugs.id, art.id, 1)

    const after = getListView(busy.db, busy.token, busy.art.id)!
    expect(after).toEqual(getListView(quiet.db, quiet.token, quiet.art.id))
    expect(after.wishes.map(wish => [wish.title, (wish as { mine: number }).mine])).toEqual([
      ['Slimme stekkers', 1],
      ['Puzzels', 0],
      ['Boek', 0],
    ])
    expect({ ...after, wishes: after.wishes.map(wish => ({ ...wish, mine: 0 })) }).toEqual(before)
    expect(getListView(busy.db, busy.token, null)).toEqual(getListView(quiet.db, quiet.token, null))
  })

  it('gives the same list to the owner after their own tick was refused', () => {
    const quiet = world(false)
    const busy = world(true)
    const before = getListView(busy.db, busy.token, busy.art.id)
    expect(codeOf(() => setPurchase(busy.db, busy.token, busy.book.id, busy.art.id, 1))).toBe('quantity_exceeded')
    expect(getListView(busy.db, busy.token, busy.art.id)).toEqual(before)
    expect(getListView(busy.db, busy.token, busy.art.id)).toEqual(getListView(quiet.db, quiet.token, quiet.art.id))
  })
})

describe('a logged-in visitor who is not an owner', () => {
  it('shows a buyer who bought how many, the notes, and which are their own', () => {
    const { db, token, mom, plugs } = world(true)
    const view = getListView(db, token, mom.id)!
    expect(view).toMatchObject({ owners: ['Art'], viewerOwnsList: false, deleted: false })
    const wish = buyerWishSchema.parse(wishIn(view, plugs.id))
    expect(wish).toMatchObject({ role: 'buyer', removed: false, bought: 2, mine: 1, quantity: 3 })
    expect(wish.purchases).toEqual([
      { name: 'Mom', quantity: 1, mine: true },
      { name: 'Sis', quantity: 1, mine: false },
    ])
    expect(wish.notes).toEqual([
      { id: expect.any(String), author: 'Mom', body: 'Ik neem er een.', createdAt: expect.any(String), mine: true },
    ])
    for (const other of view.wishes) expect(() => buyerWishSchema.parse(other)).not.toThrow()
  })

  it('keeps a deleted wish for buyers while someone has it, marked removed', () => {
    const { db, token, sis, socks } = world(true)
    const view = getListView(db, token, sis.id)
    expect(titles(view)).toEqual(['Slimme stekkers', 'Puzzels', 'Boek', 'Sokken'])
    expect(wishIn(view, socks.id)).toMatchObject({ role: 'buyer', removed: true, bought: 1, mine: 0 })
    expect(wishIn(view, socks.id)).toMatchObject({ notes: [{ author: 'Sis', body: 'Al gekocht!', mine: true }] })
  })

  it('hides a deleted wish nobody bought from everyone', () => {
    const { db, token, art, mom, socks } = world(false)
    for (const viewer of [art.id, mom.id, null]) {
      expect(titles(getListView(db, token, viewer))).toEqual(['Slimme stekkers', 'Puzzels', 'Boek'])
      expect(wishIn(getListView(db, token, viewer), socks.id)).toBeUndefined()
    }
  })
})

it('answers undefined for an unknown token', () => {
  const { db, art, mom } = world(true)
  for (const viewer of [art.id, mom.id, null]) {
    expect(getListView(db, 'AAAAAAAAAAAAAAAAAAAAAA', viewer)).toBeUndefined()
  }
})

describe('a deleted list', () => {
  it('is gone for its owner and for logged-out visitors, whatever was bought', () => {
    for (const { db, token, art } of [world(false), world(true)]) {
      deleteList(db, art.id, token)
      expect(getListView(db, token, art.id)).toBeUndefined()
      expect(getListView(db, token, null)).toBeUndefined()
    }
  })

  it('still shows a buyer what was bought on it, marked deleted', () => {
    const busy = world(true)
    deleteList(busy.db, busy.art.id, busy.token)
    const view = getListView(busy.db, busy.token, busy.mom.id)!
    expect(view).toMatchObject({ title: 'Kerst', deleted: true, viewerOwnsList: false })
    expect(titles(view)).toEqual(['Slimme stekkers', 'Boek', 'Sokken'])
    for (const wish of view.wishes) expect(buyerWishSchema.parse(wish).removed).toBe(true)

    const quiet = world(false)
    deleteList(quiet.db, quiet.art.id, quiet.token)
    expect(getListView(quiet.db, quiet.token, quiet.mom.id)).toMatchObject({ deleted: true, wishes: [] })
  })
})
