import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { wishes } from '../server/db/schema'
import { getListView } from '../server/domain/list-view'
import { deleteList, listOwnedLists, ownedListId } from '../server/domain/lists'
import { addNote } from '../server/domain/notes'
import { listNotices } from '../server/domain/notices'
import { putOnList } from '../server/domain/placement'
import { removePurchase, setPurchase } from '../server/domain/purchases'
import { copyWish, linkWish, unlinkOwner } from '../server/domain/sharing'
import { undoLink } from '../server/domain/undo'
import { createUser } from '../server/domain/users'
import { deleteWish, deleteWishes, reorderWishes, setWishImage, updateWish } from '../server/domain/wishes'
import { wishInput } from '../shared/schemas/input'
import { anonWishSchema, buyerWishSchema, ownerWishSchema, type BuyerWish } from '../shared/schemas/list'
import { addList, addOwner, addUser, addWishTo, codeOf, expectOwnersSettled, makeDb, titles, wishIn } from './helpers'

// Addresses are counted from the start of each world, so one world can hold several lists and two
// worlds built the same way still get the same addresses, and their views can be compared whole.
const tokens = vi.hoisted(() => ({ made: 0 }))
vi.mock('../server/domain/tokens', async importOriginal => ({
  ...await importOriginal<typeof import('../server/domain/tokens')>(),
  newListToken: () => 'list-' + String(++tokens.made).padStart(17, '0'),
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
  tokens.made = 0
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

  it('reorders and deletes several the same way whether or not anyone bought', () => {
    const quiet = world(false)
    const busy = world(true)
    for (const { db, token, art, plugs, puzzles, book } of [quiet, busy]) {
      expect(codeOf(() => reorderWishes(db, art.id, token, [book.id, puzzles.id, plugs.id]))).toBeUndefined()
      expect(codeOf(() => deleteWishes(db, art.id, token, [plugs.id, puzzles.id]))).toBeUndefined()
    }
    expect(getListView(busy.db, busy.token, busy.art.id)).toEqual(getListView(quiet.db, quiet.token, quiet.art.id))
    expect(getListView(busy.db, busy.token, null)).toEqual(getListView(quiet.db, quiet.token, null))
    expect(titles(getListView(busy.db, busy.token, busy.art.id))).toEqual(['Boek'])
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
      { name: 'Mom', quantity: 1, mine: true, anonymous: false },
      { name: 'Sis', quantity: 1, mine: false, anonymous: false },
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

describe('a joint wish taken off one of its lists', () => {
  /**
   * Art's list A and Lotte's list L both show the board game and the lamp; the vase is on L only.
   * With `buyersActive`, mom and sis buy all three, through either list, and write notes; that is
   * the only difference between the two worlds. Afterwards, in both, Art takes the board game off
   * A, Lotte deletes the vase, and Lotte lowers the lamp through A.
   */
  function jointWorld(buyersActive: boolean) {
    tokens.made = 0
    const db = makeDb()
    const art = addUser(db, 'art')
    const lot = addUser(db, 'lotte')
    const mom = addUser(db, 'mom')
    const sis = addUser(db, 'sis')
    const A = addList(db, art.id, 'Kerst')
    const L = addList(db, lot.id, 'Verjaardag')
    const game = addWishTo(db, art.id, A, 'Bordspel', 1)
    const lamp = addWishTo(db, art.id, A, 'Lamp', 2)
    const vase = addWishTo(db, lot.id, L, 'Vaas', 1)
    for (const wish of [game, lamp]) putOnList(db, ownedListId(db, lot.id, L), wish.id)

    if (buyersActive) {
      vi.advanceTimersByTime(60_000)
      setPurchase(db, A, game.id, mom.id, 1)
      setPurchase(db, A, lamp.id, mom.id, 1)
      setPurchase(db, L, lamp.id, sis.id, 1)
      setPurchase(db, L, vase.id, sis.id, 1)
      addNote(db, A, game.id, mom.id, 'Heb ik al.')
      addNote(db, L, lamp.id, sis.id, 'De groene.')
      vi.setSystemTime(START)
    }

    vi.advanceTimersByTime(3_600_000)
    deleteWish(db, art.id, A, game.id)
    deleteWish(db, lot.id, L, vase.id)
    updateWish(db, lot.id, A, lamp.id, wishInput.parse({ title: 'Lamp', quantity: 1 }))
    vi.setSystemTime(START)

    return { db, A, L, art, lot, mom, sis, game, lamp, vase }
  }

  it('gives its owners and logged-out visitors the same lists whether or not anyone bought or wrote', () => {
    const quiet = jointWorld(false)
    const busy = jointWorld(true)
    for (const [list, viewer] of [['A', 'art'], ['A', 'lot'], ['L', 'lot'], ['A', null], ['L', null]] as const) {
      const view = (w: typeof busy) => getListView(w.db, w[list], viewer && w[viewer].id)
      expect(view(busy), `${viewer} on ${list}`).toEqual(view(quiet))
    }
    for (const w of [quiet, busy]) {
      expect(titles(getListView(w.db, w.A, w.art.id))).toEqual(['Lamp'])
      expect(titles(getListView(w.db, w.A, w.lot.id))).toEqual(['Lamp'])
      expect(titles(getListView(w.db, w.L, w.lot.id))).toEqual(['Bordspel', 'Lamp'])
      expect(titles(getListView(w.db, w.A, null))).toEqual(['Lamp'])
      for (const wish of getListView(w.db, w.A, w.art.id)!.wishes) expect(() => ownerWishSchema.parse(wish)).not.toThrow()
      for (const wish of getListView(w.db, w.L, w.lot.id)!.wishes) expect(() => ownerWishSchema.parse(wish)).not.toThrow()
      expectOwnersSettled(w.db)
    }
  })

  it('takes a joint wish off one list and leaves it on the other, for buyers too', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    const lot = addUser(db, 'lotte')
    const mom = addUser(db, 'mom')
    const A = addList(db, art.id, 'Kerst')
    const L = addList(db, lot.id, 'Verjaardag')
    const game = addWishTo(db, art.id, A, 'Bordspel', 1)
    putOnList(db, ownedListId(db, lot.id, L), game.id)
    setPurchase(db, A, game.id, mom.id, 1)

    deleteWish(db, art.id, A, game.id)
    expect(titles(getListView(db, A, art.id))).not.toContain('Bordspel')
    expect(titles(getListView(db, A, lot.id))).not.toContain('Bordspel')
    expect(titles(getListView(db, A, null))).not.toContain('Bordspel')
    expect(wishIn(getListView(db, A, mom.id), game.id)).toMatchObject({ role: 'buyer', removed: true, mine: 1 })
    expect(wishIn(getListView(db, L, mom.id), game.id)).toMatchObject({ role: 'buyer', removed: false, bought: 1 })
    expect(wishIn(getListView(db, L, lot.id), game.id)).toMatchObject({ role: 'owner' })
    expectOwnersSettled(db)
  })

  it('shows a taken-off wish to nobody when nobody bought it', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    const lot = addUser(db, 'lotte')
    const mom = addUser(db, 'mom')
    const A = addList(db, art.id, 'Kerst')
    const L = addList(db, lot.id, 'Verjaardag')
    const game = addWishTo(db, art.id, A, 'Bordspel', 1)
    putOnList(db, ownedListId(db, lot.id, L), game.id)
    addNote(db, A, game.id, mom.id, 'Wie neemt hem?')

    deleteWish(db, art.id, A, game.id)
    for (const viewer of [art.id, lot.id, mom.id, null]) {
      expect(wishIn(getListView(db, A, viewer), game.id)).toBeUndefined()
    }
    expect(wishIn(getListView(db, L, mom.id), game.id)).toMatchObject({ role: 'buyer', removed: false, bought: 0 })
  })
})

describe('a wish deleted in step one, which kept its owners and its place on the list', () => {
  function stepOne() {
    const db = makeDb()
    const art = addUser(db, 'art')
    const mom = addUser(db, 'mom')
    const sis = addUser(db, 'sis')
    const token = addList(db, art.id)
    const socks = addWishTo(db, art.id, token, 'Sokken')
    setPurchase(db, token, socks.id, mom.id, 1)
    // What step one's delete did: mark the wish, nothing else.
    db.update(wishes).set({ deletedAt: new Date() }).where(eq(wishes.id, socks.id)).run()
    return { db, art, mom, sis, token, socks }
  }

  it('is the same removed wish as one deleted now, without any data step', () => {
    const { db, art, mom, sis, token, socks } = stepOne()
    expect(titles(getListView(db, token, art.id))).toEqual([])
    expect(titles(getListView(db, token, null))).toEqual([])
    expect(wishIn(getListView(db, token, mom.id), socks.id)).toMatchObject({ role: 'buyer', removed: true, mine: 1 })
    expect(codeOf(() => deleteWish(db, art.id, token, socks.id))).toBe('not_found')
    expect(codeOf(() => setPurchase(db, token, socks.id, sis.id, 1))).toBe('wish_removed')
  })

  it('is settled when its list is deleted, and stays a removed wish for its buyer', () => {
    const { db, art, mom, token, socks } = stepOne()
    deleteList(db, art.id, token)
    expectOwnersSettled(db)
    expect(getListView(db, token, art.id)).toBeUndefined()
    expect(wishIn(getListView(db, token, mom.id), socks.id)).toMatchObject({ role: 'buyer', removed: true, mine: 1 })
  })
})

describe('a wish with several owners', () => {
  /**
   * Art's list A ('Bordspel', 3 wanted, and 'Boek') and Lotte's list L ('Sjaal'); Lotte links
   * Bordspel onto L. With `others`, mom buys one through A, sis one through L, both write a note,
   * and `others.ticker`, the other owner, ticks one. Nothing else differs between two worlds.
   */
  function jointWorld(others: { ticker: 'art' | 'lot' } | null) {
    tokens.made = 0
    const db = makeDb()
    const art = addUser(db, 'art')
    const lot = addUser(db, 'lot')
    const mom = addUser(db, 'mom')
    const sis = addUser(db, 'sis')
    const A = addList(db, art.id, 'Kerst')
    const L = addList(db, lot.id, 'Verjaardag')
    const game = addWishTo(db, art.id, A, 'Bordspel', 3)
    const book = addWishTo(db, art.id, A, 'Boek')
    const scarf = addWishTo(db, lot.id, L, 'Sjaal')
    linkWish(db, lot.id, A, game.id, { list: L })

    if (others) {
      vi.advanceTimersByTime(60_000)
      setPurchase(db, A, game.id, mom.id, 1)
      setPurchase(db, L, game.id, sis.id, 1)
      addNote(db, A, game.id, mom.id, 'Ik neem de rode.')
      // Notes with the same time are in the order of their random ids, so give each its own.
      vi.advanceTimersByTime(1_000)
      addNote(db, L, game.id, sis.id, 'Ik de blauwe.')
      // Each owner ticks through their own list, as the page lets them.
      if (others.ticker === 'art') setPurchase(db, A, game.id, art.id, 1)
      else setPurchase(db, L, game.id, lot.id, 1)
      vi.setSystemTime(START)
    }

    return { db, A, L, art, lot, mom, sis, game, book, scarf }
  }
  type JointWorld = ReturnType<typeof jointWorld>
  const other = (me: 'art' | 'lot') => (me === 'art' ? 'lot' : 'art')
  const view = (w: JointWorld, list: 'A' | 'L', viewer: 'art' | 'lot' | 'mom' | 'sis' | null) =>
    getListView(w.db, w[list], viewer && w[viewer].id)
  const SECRETS = ['Mom', 'Sis', 'Ik neem de rode', 'Ik de blauwe']

  it.each(['art', 'lot'] as const)('gives %s the same lists and notices whether or not anyone else bought, ticked or wrote', (me) => {
    const quiet = jointWorld(null)
    const busy = jointWorld({ ticker: other(me) })
    for (const list of ['A', 'L'] as const) {
      expect(getListView(busy.db, busy[list], busy[me].id), `${me} on ${list}`).toEqual(getListView(quiet.db, quiet[list], quiet[me].id))
      expect(getListView(busy.db, busy[list], null), `a visitor on ${list}`).toEqual(getListView(quiet.db, quiet[list], null))
    }
    const plain = (w: typeof quiet) => listNotices(w.db, w[me].id).map(({ id, ...rest }) => rest)
    expect(plain(busy)).toEqual(plain(quiet))
    expect(listOwnedLists(busy.db, busy[me].id)).toEqual(listOwnedLists(quiet.db, quiet[me].id))
    // The joint wish is theirs on both lists, so it is the owner's row both times.
    for (const list of ['A', 'L'] as const) {
      expect(wishIn(getListView(busy.db, busy[list], busy[me].id), busy.game.id)).toMatchObject({ role: 'owner', mine: 0 })
    }
    expectOwnersSettled(busy.db)
  })

  it('shows each owner their own tick and not the other\'s', () => {
    // Four wanted, so mom, sis and both owners can each have one.
    const raised = (w: JointWorld) => {
      updateWish(w.db, w.art.id, w.A, w.game.id, wishInput.parse({ title: 'Bordspel', quantity: 4 }))
      return w
    }
    const busy = raised(jointWorld({ ticker: 'lot' }))
    setPurchase(busy.db, busy.A, busy.game.id, busy.art.id, 1)
    const onlyArt = raised(jointWorld(null))
    setPurchase(onlyArt.db, onlyArt.A, onlyArt.game.id, onlyArt.art.id, 1)
    const onlyLot = raised(jointWorld(null))
    setPurchase(onlyLot.db, onlyLot.L, onlyLot.game.id, onlyLot.lot.id, 1)

    for (const list of ['A', 'L'] as const) {
      expect(view(busy, list, 'art'), `art on ${list}`).toEqual(view(onlyArt, list, 'art'))
      expect(view(busy, list, 'lot'), `lot on ${list}`).toEqual(view(onlyLot, list, 'lot'))
      expect(wishIn(view(busy, list, 'art'), busy.game.id)).toMatchObject({ role: 'owner', mine: 1 })
      expect(wishIn(view(busy, list, 'lot'), busy.game.id)).toMatchObject({ role: 'owner', mine: 1 })
    }
    // Lists on which they own every wish: nothing there may even have a field about buyers.
    const own = [view(busy, 'A', 'art')!, view(busy, 'L', 'lot')!]
    for (const wish of own.flatMap(list => list.wishes)) expect(() => ownerWishSchema.parse(wish)).not.toThrow()
    const ownJson = JSON.stringify(own)
    for (const key of ['purchases', 'notes', 'bought', 'removed']) expect(ownJson).not.toContain(key)
    const allJson = JSON.stringify([...own, view(busy, 'L', 'art'), view(busy, 'A', 'lot')])
    for (const secret of SECRETS) expect(allJson).not.toContain(secret)
  })

  it('changes nothing for an owner whose tick was refused', () => {
    const quiet = jointWorld(null)
    const busy = jointWorld({ ticker: 'art' })
    const before = [view(busy, 'A', 'lot'), view(busy, 'L', 'lot')]
    expect(codeOf(() => setPurchase(busy.db, busy.L, busy.game.id, busy.lot.id, 1))).toBe('quantity_exceeded')
    expect([view(busy, 'A', 'lot'), view(busy, 'L', 'lot')]).toEqual(before)
    expect(before).toEqual([view(quiet, 'A', 'lot'), view(quiet, 'L', 'lot')])
  })

  it('gives buyers from both lists one shared state', () => {
    const { db, A, L, mom, sis, game } = jointWorld({ ticker: 'art' })
    const throughA = buyerWishSchema.parse(wishIn(getListView(db, A, mom.id), game.id))
    const throughL = buyerWishSchema.parse(wishIn(getListView(db, L, sis.id), game.id))
    expect(throughA).toMatchObject({ removed: false, bought: 3, mine: 1 })
    expect(throughL).toMatchObject({ removed: false, bought: 3, mine: 1 })
    expect(throughA.purchases).toEqual([
      { name: 'Mom', quantity: 1, mine: true, anonymous: false },
      { name: 'Sis', quantity: 1, mine: false, anonymous: false },
      { name: 'Art', quantity: 1, mine: false, anonymous: false },
    ])
    expect(throughA.notes.map(note => [note.author, note.body, note.mine])).toEqual([
      ['Mom', 'Ik neem de rode.', true],
      ['Sis', 'Ik de blauwe.', false],
    ])
    // The row names the owners the list doesn't already name, so that differs by list.
    expect([throughA.sharedWith, throughL.sharedWith]).toEqual([['Lot'], ['Art']])
    const shared = (wish: BuyerWish) => ({
      ...wish,
      mine: 0,
      sharedWith: [],
      purchases: wish.purchases.map(p => ({ ...p, mine: false })),
      notes: wish.notes.map(n => ({ ...n, mine: false })),
    })
    expect(shared(throughA)).toEqual(shared(throughL))
  })

  it('names the other owners on the row', () => {
    const w = jointWorld(null)
    const sharedWith = (list: 'A' | 'L', viewer: 'art' | 'lot' | 'mom' | null, id: number) =>
      (wishIn(view(w, list, viewer), id) as { sharedWith: string[] }).sharedWith
    expect(sharedWith('A', 'art', w.game.id)).toEqual(['Lot'])
    expect(sharedWith('L', 'lot', w.game.id)).toEqual(['Art'])
    expect(sharedWith('A', 'mom', w.game.id)).toEqual(['Lot'])
    expect(sharedWith('A', null, w.game.id)).toEqual(['Lot'])
    expect(sharedWith('L', 'mom', w.game.id)).toEqual(['Art'])
    // The list already says it is theirs, and the viewer is never named to themselves.
    expect(sharedWith('L', 'art', w.game.id)).toEqual([])
    expect(sharedWith('A', 'lot', w.game.id)).toEqual([])
    for (const viewer of ['art', 'lot', 'mom', null] as const) {
      expect(sharedWith('A', viewer, w.book.id)).toEqual([])
      expect(sharedWith('L', viewer, w.scarf.id)).toEqual([])
    }

    // By how early each came to the wish, not by who signed up first: mom links it, then Lotte
    // takes it off her list and links it again, and so comes last although her id is lower.
    const M = addList(w.db, w.mom.id, 'Mama')
    linkWish(w.db, w.mom.id, w.A, w.game.id, { list: M })
    deleteWish(w.db, w.lot.id, w.L, w.game.id)
    linkWish(w.db, w.lot.id, w.A, w.game.id, { list: w.L })
    expect(w.lot.id).toBeLessThan(w.mom.id)
    expect(sharedWith('A', 'art', w.game.id)).toEqual(['Mom', 'Lot'])
    expect(sharedWith('A', null, w.game.id)).toEqual(['Mom', 'Lot'])
    expect(sharedWith('L', 'lot', w.game.id)).toEqual(['Art', 'Mom'])
    expectOwnersSettled(w.db)
  })

  it('tells an owner whom they can unlink, by id', () => {
    const w = jointWorld(null)
    const coOwners = (list: 'A' | 'L', viewerId: number, wishId = w.game.id) =>
      ownerWishSchema.parse(wishIn(getListView(w.db, w[list], viewerId), wishId)).coOwners
    expect(coOwners('A', w.art.id)).toEqual([{ id: w.lot.id, name: 'Lot', canUnlink: true }])
    expect(coOwners('L', w.art.id)).toEqual([{ id: w.lot.id, name: 'Lot', canUnlink: true }])
    expect(coOwners('L', w.lot.id)).toEqual([{ id: w.art.id, name: 'Art', canUnlink: false }])
    expect(coOwners('A', w.art.id, w.book.id)).toEqual([])

    // Another Lot, who links it later: the two are told apart by id, never by name.
    const lot2 = createUser(w.db, { email: 'lot2@example.test', displayName: 'Lot', passwordHash: 'not-a-real-hash' })
    const L2 = addList(w.db, lot2.id, 'Lijstje')
    linkWish(w.db, lot2.id, w.A, w.game.id, { list: L2 })
    expect(lot2.id).not.toBe(w.lot.id)
    expect(coOwners('A', w.art.id)).toEqual([
      { id: w.lot.id, name: 'Lot', canUnlink: true },
      { id: lot2.id, name: 'Lot', canUnlink: true },
    ])
    expect(coOwners('L', w.lot.id)).toEqual([
      { id: w.art.id, name: 'Art', canUnlink: false },
      { id: lot2.id, name: 'Lot', canUnlink: true },
    ])
    expect(coOwners('L', lot2.id)).toEqual([
      { id: w.art.id, name: 'Art', canUnlink: false },
      { id: w.lot.id, name: 'Lot', canUnlink: false },
    ])
    unlinkOwner(w.db, w.art.id, w.A, w.game.id, lot2.id)
    expect(coOwners('A', w.art.id)).toEqual([{ id: w.lot.id, name: 'Lot', canUnlink: true }])

    // A co-owner of the list came at the same moment, so is listed but can't be unlinked.
    addOwner(w.db, w.A, w.mom.id)
    expect(coOwners('A', w.art.id)).toEqual([
      { id: w.mom.id, name: 'Mom', canUnlink: false },
      { id: w.lot.id, name: 'Lot', canUnlink: true },
    ])
    expect(coOwners('A', w.art.id, w.book.id)).toEqual([{ id: w.mom.id, name: 'Mom', canUnlink: false }])
    expect(wishIn(view(w, 'A', 'art'), w.game.id)).toMatchObject({ sharedWith: ['Lot'] })
    expectOwnersSettled(w.db)
  })

  it('says whether taking a wish off deletes it', () => {
    const w = jointWorld(null)
    const elsewhere = (list: 'A' | 'L', viewer: 'art' | 'lot', id: number) =>
      ownerWishSchema.parse(wishIn(view(w, list, viewer), id)).alsoElsewhere
    expect(elsewhere('A', 'art', w.game.id)).toBe(true)
    expect(elsewhere('L', 'lot', w.game.id)).toBe(true)
    expect(elsewhere('A', 'art', w.book.id)).toBe(false)
    expect(elsewhere('L', 'lot', w.scarf.id)).toBe(false)
    deleteWish(w.db, w.art.id, w.A, w.game.id)
    expect(elsewhere('L', 'lot', w.game.id)).toBe(false)
  })

  it.each(['art', 'lot'] as const)('hides a taken-off joint wish the same way in both worlds, for %s', (me) => {
    const quiet = jointWorld(null)
    const busy = jointWorld({ ticker: other(me) })
    for (const w of [quiet, busy]) deleteWish(w.db, w.art.id, w.A, w.game.id)

    for (const viewer of ['art', 'lot'] as const) {
      expect(view(busy, 'A', viewer), `${viewer} on A`).toEqual(view(quiet, 'A', viewer))
      expect(wishIn(view(busy, 'A', viewer), busy.game.id)).toBeUndefined()
    }
    expect(view(busy, 'A', null)).toEqual(view(quiet, 'A', null))
    // Lotte still owns it through L. Art no longer owns it, so on L he is a buyer like any other.
    if (me === 'lot') expect(view(busy, 'L', 'lot')).toEqual(view(quiet, 'L', 'lot'))
    expect(listNotices(busy.db, busy[me].id).map(({ id, ...rest }) => rest))
      .toEqual(listNotices(quiet.db, quiet[me].id).map(({ id, ...rest }) => rest))

    expect(wishIn(view(busy, 'A', 'mom'), busy.game.id)).toMatchObject({ role: 'buyer', removed: true, bought: 3, mine: 1 })
    expect(wishIn(view(quiet, 'A', 'mom'), quiet.game.id)).toBeUndefined()
    for (const w of [quiet, busy]) {
      expect(wishIn(view(w, 'L', 'lot'), w.game.id)).toMatchObject({ role: 'owner', sharedWith: [], coOwners: [], alsoElsewhere: false })
      expect(wishIn(view(w, 'L', 'mom'), w.game.id)).toMatchObject({ role: 'buyer', removed: false })
      expectOwnersSettled(w.db)
    }
  })

  it('gives an unlinked person the same list in both worlds', () => {
    const quiet = jointWorld(null)
    const busy = jointWorld({ ticker: 'art' })
    for (const w of [quiet, busy]) unlinkOwner(w.db, w.art.id, w.A, w.game.id, w.lot.id)

    expect(view(busy, 'L', 'lot')).toEqual(view(quiet, 'L', 'lot'))
    expect(listNotices(busy.db, busy.lot.id).map(({ id, ...rest }) => rest))
      .toEqual(listNotices(quiet.db, quiet.lot.id).map(({ id, ...rest }) => rest))
    const hers = view(busy, 'L', 'lot')!
    expect(wishIn(hers, busy.game.id)).toBeUndefined()
    const copy = hers.wishes.find(wish => wish.title === 'Bordspel')
    expect(copy).toMatchObject({ role: 'owner', mine: 0, quantity: 3, sharedWith: [], coOwners: [], alsoElsewhere: false })
    expect(copy!.id).not.toBe(busy.game.id)
    for (const secret of SECRETS) expect(JSON.stringify(hers)).not.toContain(secret)
    expectOwnersSettled(busy.db)
  })

  it('makes a former owner a buyer again on the other owner\'s list', () => {
    const { db, A, art, lot, game } = jointWorld({ ticker: 'art' })
    unlinkOwner(db, art.id, A, game.id, lot.id)
    const wish = buyerWishSchema.parse(wishIn(getListView(db, A, lot.id), game.id))
    expect(wish).toMatchObject({ role: 'buyer', removed: false, bought: 3, mine: 0, sharedWith: [] })
    expect(wish.purchases.map(p => p.name)).toEqual(['Mom', 'Sis', 'Art'])
    expect(wish.notes.map(n => n.author)).toEqual(['Mom', 'Sis'])
  })

  it('reaches no wish through a list that does not show it', () => {
    const { db, A, L, art, lot, mom, book } = jointWorld({ ticker: 'art' })
    const M = addList(db, mom.id, 'Mama')
    const attempts: [string, () => unknown][] = [
      ['setPurchase', () => setPurchase(db, L, book.id, mom.id, 1)],
      ['removePurchase', () => removePurchase(db, L, book.id, mom.id)],
      ['addNote', () => addNote(db, L, book.id, mom.id, 'Via de verkeerde lijst.')],
      ['updateWish', () => updateWish(db, art.id, L, book.id, wishInput.parse({ title: 'Ander boek', quantity: 1 }))],
      ['setWishImage', () => setWishImage(db, art.id, L, book.id, 'boek.png')],
      ['linkWish', () => linkWish(db, mom.id, L, book.id, { list: M })],
      ['copyWish', () => copyWish(db, mom.id, L, book.id, { list: M })],
      ['unlinkOwner', () => unlinkOwner(db, art.id, L, book.id, lot.id)],
      ['undoLink', () => undoLink(db, art.id, L, book.id, lot.id)],
    ]
    for (const [name, attempt] of attempts) expect(codeOf(attempt), name).toBe('not_found')
    // Through the list that does show it, the same request goes through.
    setPurchase(db, A, book.id, mom.id, 1)
    expect(wishIn(getListView(db, A, mom.id), book.id)).toMatchObject({ role: 'buyer', mine: 1 })
    expect(wishIn(getListView(db, L, mom.id), book.id)).toBeUndefined()
  })
})
