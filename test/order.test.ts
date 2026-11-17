import { describe, expect, it } from 'vitest'
import { getListView } from '../server/domain/list-view'
import { ownedListId } from '../server/domain/lists'
import { putOnList } from '../server/domain/placement'
import { setPurchase } from '../server/domain/purchases'
import { linkWish } from '../server/domain/sharing'
import { deleteWish } from '../server/domain/wishes'
import { addList, addUser, addWishTo, makeDb, titles } from './helpers'

function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const mom = addUser(db, 'mom')
  const token = addList(db, art.id)
  return { db, art, mom, token, listId: ownedListId(db, art.id, token) }
}

describe('the order of a list', () => {
  it('shows wishes in the order they were added, to everyone', () => {
    const { db, art, mom, token } = setup()
    for (const title of ['A', 'B', 'C']) addWishTo(db, art.id, token, title)
    const b = getListView(db, token, art.id)!.wishes[1]!
    setPurchase(db, token, b.id, mom.id, 1)
    expect(titles(getListView(db, token, art.id))).toEqual(['A', 'B', 'C'])
    expect(titles(getListView(db, token, mom.id))).toEqual(['A', 'B', 'C'])
    expect(titles(getListView(db, token, null))).toEqual(['A', 'B', 'C'])
  })

  it('puts a wish that comes back at the bottom', () => {
    const { db, art, token, listId } = setup()
    const a = addWishTo(db, art.id, token, 'A')
    addWishTo(db, art.id, token, 'B')
    addWishTo(db, art.id, token, 'C')
    // Also on a second list, so taking it off this one doesn't delete it.
    putOnList(db, ownedListId(db, art.id, addList(db, art.id, 'Verjaardag')), a.id)
    deleteWish(db, art.id, token, a.id)
    expect(titles(getListView(db, token, art.id))).toEqual(['B', 'C'])
    putOnList(db, listId, a.id)
    expect(titles(getListView(db, token, art.id))).toEqual(['B', 'C', 'A'])
  })

  it('puts a linked wish at the bottom, even when it was made before the others', () => {
    const { db, art, mom, token } = setup()
    const M = addList(db, mom.id, 'Van mama')
    const x = addWishTo(db, mom.id, M, 'X')
    addWishTo(db, art.id, token, 'A')
    addWishTo(db, art.id, token, 'B')
    linkWish(db, art.id, M, x.id, { list: token })
    expect(titles(getListView(db, token, art.id))).toEqual(['A', 'B', 'X'])
  })
})
