import { describe, expect, it } from 'vitest'
import { getListView } from '../server/domain/list-view'
import { ownedListId } from '../server/domain/lists'
import { putOnList } from '../server/domain/placement'
import { setPurchase } from '../server/domain/purchases'
import { linkWish } from '../server/domain/sharing'
import { deleteWish, reorderWishes } from '../server/domain/wishes'
import { deleteInput, wishesDeleteInput, wishIdsInput } from '../shared/schemas/input'
import { addList, addUser, addWishTo, codeOf, makeDb, titles } from './helpers'

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

describe('reordering a list', () => {
  function abcd() {
    const { db, art, mom, token, listId } = setup()
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(title => addWishTo(db, art.id, token, title).id) as [number, number, number, number]
    return { db, art, mom, token, listId, a, b, c, d }
  }

  it('reorders the wishes, for everyone', () => {
    const { db, art, token, a, b, c, d } = abcd()
    reorderWishes(db, art.id, token, [c, a, d, b])
    expect(titles(getListView(db, token, art.id))).toEqual(['C', 'A', 'D', 'B'])
    expect(titles(getListView(db, token, null))).toEqual(['C', 'A', 'D', 'B'])
  })

  it('keeps the wishes left out after the ones given, in their order', () => {
    const { db, art, token, b, d } = abcd()
    reorderWishes(db, art.id, token, [d, b])
    expect(titles(getListView(db, token, art.id))).toEqual(['D', 'B', 'A', 'C'])
  })

  it('ignores ids that are not on the list now', () => {
    const { db, art, mom, token, a, b, c, d } = abcd()
    const M = addList(db, mom.id, 'Van mama')
    const m = addWishTo(db, mom.id, M, 'M')
    deleteWish(db, art.id, token, a)
    reorderWishes(db, art.id, token, [m.id, a, d, c, b])
    expect(titles(getListView(db, token, art.id))).toEqual(['D', 'C', 'B'])
    expect(titles(getListView(db, M, mom.id))).toEqual(['M'])
  })

  it('puts a wish added after a reorder at the bottom', () => {
    const { db, art, token, a, b, c, d } = abcd()
    reorderWishes(db, art.id, token, [d, c, b, a])
    addWishTo(db, art.id, token, 'E')
    expect(titles(getListView(db, token, art.id))).toEqual(['D', 'C', 'B', 'A', 'E'])
  })

  it('refuses someone who doesn\'t own the list', () => {
    const { db, mom, token, a, b } = abcd()
    expect(codeOf(() => reorderWishes(db, mom.id, token, [b, a]))).toBe('not_found')
  })

  it('refuses the same id twice', () => {
    expect(wishIdsInput.safeParse({ wishIds: [1, 1] }).success).toBe(false)
    expect(wishIdsInput.safeParse({ wishIds: [1, 2] }).success).toBe(true)
    expect(wishIdsInput.safeParse({ wishIds: [] }).success).toBe(false)
  })

  it('lets a delete say that whoever bought it should not keep seeing it, and a new order say nothing of the kind', () => {
    expect(wishesDeleteInput.parse({ wishIds: [1, 2] })).toEqual({ wishIds: [1, 2] })
    expect(wishesDeleteInput.parse({ wishIds: [1, 2], clearForBuyers: true })).toEqual({ wishIds: [1, 2], clearForBuyers: true })
    expect(wishesDeleteInput.safeParse({ wishIds: [1, 2], clearForBuyers: 'yes' }).success).toBe(false)
    expect(wishesDeleteInput.safeParse({ wishIds: [1, 1] }).success).toBe(false)
    expect(wishIdsInput.safeParse({ wishIds: [1, 2], clearForBuyers: true }).success).toBe(false)
    expect(deleteInput.parse({})).toEqual({})
    expect(deleteInput.parse({ clearForBuyers: true })).toEqual({ clearForBuyers: true })
    expect(deleteInput.safeParse({ clearForBuyers: 1 }).success).toBe(false)
    expect(deleteInput.safeParse({ other: true }).success).toBe(false)
  })
})
