import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answerRequest, askFriend, listRequests, setShownToOne } from '../server/domain/friends'
import { deleteList, ownedListId, relinkList } from '../server/domain/lists'
import { putOnList } from '../server/domain/placement'
import { listGiven, removePurchase, setPurchase } from '../server/domain/purchases'
import { deleteUser } from '../server/domain/users'
import { forgetList, rememberList } from '../server/domain/visits'
import { deleteWish } from '../server/domain/wishes'
import { KEPT_FOR_BUYERS_DAYS } from '../shared/utils/kept-for-buyers'
import { addList, addUser, addWishTo, makeDb } from './helpers'

// What the home page shows someone of what they give. The order is decided by timestamps, so
// the clock only moves when a test moves it.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())
const later = (ms = 1000) => vi.setSystemTime(new Date(Date.now() + ms))
const DAY = 24 * 60 * 60 * 1000

/** Art's list "Kerst" with two wishes and Lotte's list "Verjaardag" with one. Mom opened both. */
function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lot = addUser(db, 'lot')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const kerst = addList(db, art.id, 'Kerst')
  const verjaardag = addList(db, lot.id, 'Verjaardag')
  const plugs = addWishTo(db, art.id, kerst, 'Slimme stekkers', 3)
  const book = addWishTo(db, art.id, kerst, 'Boek')
  const game = addWishTo(db, lot.id, verjaardag, 'Bordspel')
  rememberList(db, mom.id, kerst)
  rememberList(db, mom.id, verjaardag)
  return { db, art, lot, mom, sis, kerst, verjaardag, plugs, book, game }
}

/** Who each group is for and the titles under it, in the order the page shows them. */
const outline = (groups: ReturnType<typeof listGiven>) => groups.map(group => [group.names, group.wishes.map(wish => wish.title)])

describe('what someone gives, on their home page', () => {
  it('is empty for someone who ticked nothing', () => {
    const { db, mom } = setup()
    expect(listGiven(db, mom.id)).toEqual([])
  })

  it('names the wish, how many, who it is for and the list to open it on', () => {
    const { db, mom, kerst, plugs } = setup()
    setPurchase(db, kerst, plugs.id, mom.id, 2)
    expect(listGiven(db, mom.id)).toEqual([{
      names: ['Art'],
      wishes: [{ id: plugs.id, title: 'Slimme stekkers', image: null, mine: 2, quantity: 3, token: kerst, listTitle: 'Kerst', removed: false }],
    }])
  })

  it('groups by who it is for, the people ticked for last first, and the last tick first under each', () => {
    const { db, mom, kerst, verjaardag, plugs, book, game } = setup()
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    later()
    setPurchase(db, verjaardag, game.id, mom.id, 1)
    expect(outline(listGiven(db, mom.id))).toEqual([[['Lot'], ['Bordspel']], [['Art'], ['Slimme stekkers']]])
    later()
    setPurchase(db, kerst, book.id, mom.id, 1)
    expect(outline(listGiven(db, mom.id))).toEqual([[['Art'], ['Boek', 'Slimme stekkers']], [['Lot'], ['Bordspel']]])
  })

  it('keeps its place when the amount changes: the order is by the first tick', () => {
    const { db, mom, kerst, plugs, book } = setup()
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    later()
    setPurchase(db, kerst, book.id, mom.id, 1)
    later()
    setPurchase(db, kerst, plugs.id, mom.id, 3)
    expect(outline(listGiven(db, mom.id))).toEqual([[['Art'], ['Boek', 'Slimme stekkers']]])
    expect(listGiven(db, mom.id)[0]!.wishes[1]).toMatchObject({ mine: 3 })
  })

  it('drops what was taken back', () => {
    const { db, mom, kerst, plugs } = setup()
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    removePurchase(db, kerst, plugs.id, mom.id)
    expect(listGiven(db, mom.id)).toEqual([])
  })

  it('keeps two people with the same name apart', () => {
    const { db, mom, kerst, plugs } = setup()
    const other = addUser(db, 'art2')
    db.run(`update users set display_name = 'Art' where id = ${other.id}`)
    const second = addList(db, other.id, 'Nieuwjaar')
    const socks = addWishTo(db, other.id, second, 'Sokken')
    rememberList(db, mom.id, second)
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    later()
    setPurchase(db, second, socks.id, mom.id, 1)
    expect(outline(listGiven(db, mom.id))).toEqual([[['Art'], ['Sokken']], [['Art'], ['Slimme stekkers']]])
  })
})

describe('whose it is', () => {
  it('names everyone a joint wish belongs to, the owners of the list it is opened on first', () => {
    const { db, lot, mom, kerst, verjaardag, plugs, book } = setup()
    // Lotte shares the plugs with Art: they are on her list too.
    putOnList(db, ownedListId(db, lot.id, verjaardag), plugs.id)
    later()
    rememberList(db, mom.id, kerst)
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    later()
    setPurchase(db, kerst, book.id, mom.id, 1)
    // The book is Art's alone, so it is a group of its own.
    expect(outline(listGiven(db, mom.id))).toEqual([[['Art'], ['Boek']], [['Art', 'Lot'], ['Slimme stekkers']]])
  })

  it('leaves out a wish the person owns themselves', () => {
    const { db, art, lot, kerst, verjaardag, plugs, book } = setup()
    setPurchase(db, kerst, book.id, art.id, 1)
    expect(listGiven(db, art.id)).toEqual([])
    // Also a joint one, ticked on the other owner's list.
    putOnList(db, ownedListId(db, lot.id, verjaardag), plugs.id)
    rememberList(db, art.id, verjaardag)
    setPurchase(db, verjaardag, plugs.id, art.id, 1)
    expect(listGiven(db, art.id)).toEqual([])
  })

  it('leaves out a wish the person ticked as its owner and then took off their own list', () => {
    const { db, art, kerst, book } = setup()
    setPurchase(db, kerst, book.id, art.id, 1)
    deleteWish(db, art.id, kerst, book.id)
    expect(listGiven(db, art.id)).toEqual([])
  })

  it('has a group without names for a list whose owner is gone', () => {
    const { db, lot, mom, verjaardag, game } = setup()
    setPurchase(db, verjaardag, game.id, mom.id, 1)
    deleteUser(db, lot.id)
    expect(outline(listGiven(db, mom.id))).toEqual([[[], ['Bordspel']]])
  })
})

describe('only what the lists on the person\'s page show them', () => {
  it('leaves out what is on a list they took off their page, and has it back when they open it again', () => {
    const { db, mom, kerst, plugs } = setup()
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    forgetList(db, mom.id, kerst)
    expect(listGiven(db, mom.id)).toEqual([])
    rememberList(db, mom.id, kerst)
    expect(outline(listGiven(db, mom.id))).toEqual([[['Art'], ['Slimme stekkers']]])
  })

  it('never links to a list the person has no link of, though it shows the wish', () => {
    const { db, lot, sis, kerst, verjaardag, plugs } = setup()
    putOnList(db, ownedListId(db, lot.id, verjaardag), plugs.id)
    // Sis has Art's list only.
    rememberList(db, sis.id, kerst)
    setPurchase(db, kerst, plugs.id, sis.id, 1)
    expect(listGiven(db, sis.id)[0]!.wishes[0]).toMatchObject({ token: kerst, listTitle: 'Kerst' })
    forgetList(db, sis.id, kerst)
    expect(JSON.stringify(listGiven(db, sis.id))).not.toContain(verjaardag)
    expect(listGiven(db, sis.id)).toEqual([])
  })

  it('opens a wish two of their lists show on the one they opened last', () => {
    const { db, lot, mom, kerst, verjaardag, plugs } = setup()
    putOnList(db, ownedListId(db, lot.id, verjaardag), plugs.id)
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    later()
    rememberList(db, mom.id, verjaardag)
    expect(listGiven(db, mom.id)).toMatchObject([{ names: ['Lot', 'Art'], wishes: [{ token: verjaardag, listTitle: 'Verjaardag' }] }])
    later()
    rememberList(db, mom.id, kerst)
    expect(listGiven(db, mom.id)).toMatchObject([{ names: ['Art', 'Lot'], wishes: [{ token: kerst, listTitle: 'Kerst' }] }])
  })

  it('counts a list a friend shows them, which they never opened by its link', () => {
    const { db, art, sis, kerst, plugs } = setup()
    const sisList = addList(db, sis.id, 'Lijst van sis')
    expect(askFriend(db, art.id, sisList, sis.id)).toBe('asked')
    answerRequest(db, sis.id, listRequests(db, sis.id).incoming[0]!.id, true)
    setShownToOne(db, art.id, kerst, sis.id, true)
    setPurchase(db, kerst, plugs.id, sis.id, 1)
    expect(listGiven(db, sis.id)).toMatchObject([{ names: ['Art'], wishes: [{ title: 'Slimme stekkers', token: kerst }] }])
    setShownToOne(db, art.id, kerst, sis.id, false)
    expect(listGiven(db, sis.id)).toEqual([])
  })

  it('leaves out what is on a list that got a new link, until they open the new one', () => {
    const { db, art, mom, kerst, plugs } = setup()
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    const fresh = relinkList(db, art.id, kerst).token
    expect(JSON.stringify(listGiven(db, mom.id))).not.toContain(fresh)
    expect(listGiven(db, mom.id)).toEqual([])
    rememberList(db, mom.id, fresh)
    expect(listGiven(db, mom.id)).toMatchObject([{ wishes: [{ token: fresh }] }])
  })
})

describe('a wish that left its list', () => {
  it('stays, marked, for as long as its buyer keeps seeing it on the list', () => {
    const { db, art, mom, kerst, plugs } = setup()
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    deleteWish(db, art.id, kerst, plugs.id)
    expect(listGiven(db, mom.id)).toMatchObject([{ names: ['Art'], wishes: [{ title: 'Slimme stekkers', token: kerst, removed: true }] }])
    later(KEPT_FOR_BUYERS_DAYS * DAY - 2000)
    expect(listGiven(db, mom.id)).toHaveLength(1)
    later(2000)
    expect(listGiven(db, mom.id)).toEqual([])
  })

  it('is gone at once when its owner said so', () => {
    const { db, art, mom, kerst, plugs } = setup()
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    deleteWish(db, art.id, kerst, plugs.id, { clearForBuyers: true })
    expect(listGiven(db, mom.id)).toEqual([])
  })

  it('stays the same way when the whole list is deleted', () => {
    const { db, art, mom, kerst, plugs } = setup()
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    deleteList(db, art.id, kerst)
    expect(listGiven(db, mom.id)).toMatchObject([{ names: ['Art'], wishes: [{ token: kerst, listTitle: 'Kerst', removed: true }] }])
    later(KEPT_FOR_BUYERS_DAYS * DAY)
    expect(listGiven(db, mom.id)).toEqual([])
  })

  it('is shown on a list that still has it before one it left', () => {
    const { db, art, lot, mom, kerst, verjaardag, plugs } = setup()
    putOnList(db, ownedListId(db, lot.id, verjaardag), plugs.id)
    setPurchase(db, kerst, plugs.id, mom.id, 1)
    later()
    rememberList(db, mom.id, kerst)
    deleteWish(db, art.id, kerst, plugs.id)
    // Art's list was opened last, but the wish is only Lotte's now.
    expect(listGiven(db, mom.id)).toMatchObject([{ names: ['Lot'], wishes: [{ token: verjaardag, removed: false }] }])
  })
})

describe('what it says about anyone else', () => {
  it('is the same whatever the other buyers did', () => {
    const quiet = setup()
    const busy = setup()
    for (const { db, mom, kerst, plugs } of [quiet, busy]) setPurchase(db, kerst, plugs.id, mom.id, 1)
    rememberList(busy.db, busy.sis.id, busy.kerst)
    setPurchase(busy.db, busy.kerst, busy.plugs.id, busy.sis.id, 2)
    setPurchase(busy.db, busy.kerst, busy.book.id, busy.sis.id, 1)
    const at = (groups: ReturnType<typeof listGiven>) => JSON.stringify(groups).replaceAll(/"token":"[^"]+"/g, '')
    expect(at(listGiven(busy.db, busy.mom.id))).toEqual(at(listGiven(quiet.db, quiet.mom.id)))
    // An owner learns nothing from their own page.
    expect(listGiven(busy.db, busy.art.id)).toEqual([])
  })
})
