import { describe, expect, it } from 'vitest'
import type { WishView } from '../shared/schemas/list'
import { removedLast } from '../shared/utils/wish-order'

const base = {
  title: 'Boek',
  description: null,
  url: null,
  image: null,
  quantity: 1,
  createdAt: '2026-11-17T10:00:00.000Z',
  updatedAt: '2026-11-17T10:00:00.000Z',
}

const buyer = (id: number, removed: boolean): WishView =>
  ({ ...base, id, role: 'buyer', removed, bought: 1, mine: 0, purchases: [], notes: [] })
const owner = (id: number): WishView => ({ ...base, id, role: 'owner', mine: 0 })
const anon = (id: number): WishView => ({ ...base, id, role: 'anon' })

describe('the order of the rows on a list', () => {
  it('puts removed wishes after everything still wanted, each group in the order it came', () => {
    const wishes = [buyer(1, true), buyer(2, false), owner(3), buyer(4, true), anon(5)]
    expect(removedLast(wishes).map(wish => wish.id)).toEqual([2, 3, 5, 1, 4])
  })

  it('leaves a list without removed wishes as it is', () => {
    const wishes = [owner(1), buyer(2, false), anon(3)]
    expect(removedLast(wishes).map(wish => wish.id)).toEqual([1, 2, 3])
  })

  it('does not change the list it was given', () => {
    const wishes = [buyer(1, true), buyer(2, false)]
    removedLast(wishes)
    expect(wishes.map(wish => wish.id)).toEqual([1, 2])
  })
})
