import { describe, expect, it } from 'vitest'
import { getListView, oldLinkView } from '../server/domain/list-view'
import { deleteList, relinkList } from '../server/domain/lists'
import { addNote } from '../server/domain/notes'
import { removePurchase, setPurchase } from '../server/domain/purchases'
import { copyWish, linkWish } from '../server/domain/sharing'
import type { ListView } from '../shared/schemas/list'
import { buyerWishSchema } from '../shared/schemas/list'
import { addList, addUser, addWishTo, codeOf, makeDb, purchaseRows, titles, wishIn } from './helpers'

// A list that got a new link. Its old address no longer opens it; it only still shows someone
// what they themselves were giving from it, so they can lower that or take it back.

/**
 * Art's "Kerst" with socks (1), glasses (4) and a book (1). Mom ticks the socks, takes two
 * glasses and writes a note; Sis ticks the book; Lotte only looked. Then Art gives it a new link.
 */
function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const lot = addUser(db, 'lot')
  const old = addList(db, art.id, 'Kerst')
  const momList = addList(db, mom.id, 'Lijst van mom')
  const sokken = addWishTo(db, art.id, old, 'Sokken')
  const glazen = addWishTo(db, art.id, old, 'Glazen', 4)
  const boek = addWishTo(db, art.id, old, 'Boek')
  setPurchase(db, old, sokken.id, mom.id, 1)
  setPurchase(db, old, glazen.id, mom.id, 2)
  addNote(db, old, sokken.id, mom.id, 'Maat 43.')
  setPurchase(db, old, boek.id, sis.id, 1)
  const { token } = relinkList(db, art.id, old)
  return { db, art, mom, sis, lot, old, token, momList, sokken, glazen, boek }
}

describe('the old address of a list that got a new link', () => {
  it('is nothing for a visitor and for someone who ticked nothing there', () => {
    const { db, lot, old } = setup()
    expect(oldLinkView(db, old, null)).toBeUndefined()
    expect(oldLinkView(db, old, lot.id)).toBeUndefined()
  })

  it('sends an owner on to the new address', () => {
    const { db, art, old, token } = setup()
    expect(oldLinkView(db, old, art.id)).toEqual({ movedTo: token })
  })

  it('shows someone who ticked there only their own ticks', () => {
    const { db, mom, old } = setup()
    const forMom = oldLinkView(db, old, mom.id) as ListView
    expect(forMom).toMatchObject({ token: old, title: 'Kerst', owners: [], viewerOwnsList: false, deleted: false, old: true })
    expect(forMom.wishes).toMatchObject([
      { title: 'Sokken', role: 'buyer', removed: true, mine: 1, bought: 1, sharedWith: [], notes: [], purchases: [{ mine: true, quantity: 1 }] },
      { title: 'Glazen', role: 'buyer', removed: true, mine: 2, bought: 2, sharedWith: [], notes: [], purchases: [{ mine: true, quantity: 2 }] },
    ])
    for (const wish of forMom.wishes) expect(() => buyerWishSchema.parse(wish)).not.toThrow()
    // Nothing of the others, and not the new address.
    const json = JSON.stringify(forMom)
    for (const secret of ['Sis', 'Boek', 'Maat 43', 'Art']) expect(json).not.toContain(secret)
  })

  it('is never what the ordinary view answers, and that view is never marked old', () => {
    const { db, mom, old, token } = setup()
    expect(getListView(db, old, mom.id)).toBeUndefined()
    expect(getListView(db, token, mom.id)).toMatchObject({ old: false })
    expect(getListView(db, token, null)).toMatchObject({ old: false })
    expect(oldLinkView(db, token, mom.id)).toBeUndefined()
    expect(oldLinkView(db, 'no-such-list-token-000', mom.id)).toBeUndefined()
  })

  it('lets them lower and take back what they ticked', () => {
    const { db, mom, sis, old, token, sokken, glazen } = setup()
    setPurchase(db, old, glazen.id, mom.id, 1)
    expect(purchaseRows(db, glazen.id)).toEqual([{ userId: mom.id, quantity: 1 }])
    removePurchase(db, old, sokken.id, mom.id)
    removePurchase(db, old, glazen.id, mom.id)
    // Nothing of hers is left there, so the address is nothing to her any more.
    expect(oldLinkView(db, old, mom.id)).toBeUndefined()
    // At the new address the others see the socks free again.
    expect(wishIn(getListView(db, token, sis.id), sokken.id)).toMatchObject({ bought: 0, removed: false })
  })

  it('gives nobody anything more', () => {
    const { db, mom, lot, old, momList, sokken, glazen, boek } = setup()
    expect(codeOf(() => setPurchase(db, old, glazen.id, mom.id, 3))).toBe('wish_removed')
    // A wish she never ticked, and someone who ticked nothing: as if the address didn't exist.
    expect(codeOf(() => setPurchase(db, old, boek.id, mom.id, 1))).toBe('not_found')
    expect(codeOf(() => setPurchase(db, old, sokken.id, lot.id, 1))).toBe('not_found')
    expect(codeOf(() => addNote(db, old, sokken.id, mom.id, 'x'))).toBe('not_found')
    expect(codeOf(() => copyWish(db, mom.id, old, sokken.id, { list: momList }))).toBe('not_found')
    expect(codeOf(() => linkWish(db, mom.id, old, sokken.id, { list: momList }))).toBe('not_found')
    expect(purchaseRows(db, glazen.id)).toEqual([{ userId: mom.id, quantity: 2 }])
    expect(purchaseRows(db, boek.id).map(row => row.userId)).not.toContain(mom.id)
    expect(titles(getListView(db, momList, mom.id))).toEqual([])
  })

  it('keeps working after a second new link, for both old addresses', () => {
    const { db, art, mom, old, token, sokken } = setup()
    const { token: third } = relinkList(db, art.id, token)
    expect(titles(oldLinkView(db, old, mom.id) as ListView)).toEqual(['Sokken', 'Glazen'])
    expect(titles(oldLinkView(db, token, mom.id) as ListView)).toEqual(['Sokken', 'Glazen'])
    expect(oldLinkView(db, token, art.id)).toEqual({ movedTo: third })
    removePurchase(db, old, sokken.id, mom.id)
    expect(titles(oldLinkView(db, token, mom.id) as ListView)).toEqual(['Glazen'])
  })

  it('still shows a buyer their ticks after the list is deleted, and its owner nothing', () => {
    const { db, art, mom, old, token, glazen } = setup()
    deleteList(db, art.id, token)
    expect(oldLinkView(db, old, art.id)).toBeUndefined()
    expect(titles(oldLinkView(db, old, mom.id) as ListView)).toEqual(['Sokken', 'Glazen'])
    setPurchase(db, old, glazen.id, mom.id, 1)
    expect(purchaseRows(db, glazen.id)).toEqual([{ userId: mom.id, quantity: 1 }])
  })

  it('treats someone who owns one wish there, but not the list, like any buyer with a tick', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    const lot = addUser(db, 'lot')
    const old = addList(db, art.id, 'Kerst')
    const lotList = addList(db, lot.id, 'Lijst van lot')
    const spel = addWishTo(db, art.id, old, 'Bordspel')
    const sokken = addWishTo(db, art.id, old, 'Sokken')
    linkWish(db, lot.id, old, spel.id, { list: lotList })
    setPurchase(db, old, sokken.id, lot.id, 1)
    relinkList(db, art.id, old)
    const forLot = oldLinkView(db, old, lot.id) as ListView
    expect(forLot).toMatchObject({ old: true })
    expect(forLot.wishes).toMatchObject([{ title: 'Sokken', role: 'buyer', mine: 1 }])
  })
})
