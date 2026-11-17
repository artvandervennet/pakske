import { describe, expect, it } from 'vitest'
import type { AnonWish, BuyerWish, OwnerWish } from '../shared/schemas/list'
import { wishLine, wishOwnerTag, type Translate } from '../shared/utils/wish-line'

// Writes out the key and its arguments instead of a sentence, so a test can see which strings
// a line is made of without depending on the wording in the locale files.
const t: Translate = (key: string, arg: number | Record<string, unknown>) =>
  typeof arg === 'number' ? `[${key} ${arg}]` : `[${key}]`

const base = {
  id: 1,
  title: 'Slimme stekkers',
  description: null,
  url: null,
  image: null,
  createdAt: '2026-11-17T10:00:00.000Z',
  updatedAt: '2026-11-17T10:00:00.000Z',
}

function owner(quantity: number | null, mine: number, extra: Partial<OwnerWish> = {}): OwnerWish {
  return { ...base, role: 'owner', quantity, mine, sharedWith: [], coOwners: [], alsoElsewhere: false, ...extra }
}

function buyer(quantity: number | null, purchases: BuyerWish['purchases'], extra: Partial<BuyerWish> = {}): BuyerWish {
  const bought = purchases.reduce((sum, purchase) => sum + purchase.quantity, 0)
  const mine = purchases.find(purchase => purchase.mine)?.quantity ?? 0
  return { ...base, role: 'buyer', quantity, sharedWith: [], removed: false, bought, mine, purchases, notes: [], ...extra }
}

describe("a row's second line", () => {
  it('never tells an owner what is left, whatever the amount', () => {
    for (const quantity of [1, 3, null]) {
      for (const mine of [0, 1, 2]) {
        const line = wishLine(owner(quantity, mine, { url: 'https://www.coolblue.be/x' }), t)
        expect(line).not.toContain('wish.left')
      }
    }
  })

  it('tells an owner who got it themselves that they did', () => {
    expect(wishLine(owner(1, 1), t)).toBe('[wish.yours 1]')
    expect(wishLine(owner(3, 2), t)).toBe('[wish.yours 2]')
  })

  it("shows an owner who got nothing the wish's own text or shop", () => {
    expect(wishLine(owner(3, 0, { description: 'Twee  voor\nde living' }), t)).toBe('Twee voor de living')
    expect(wishLine(owner(3, 0, { url: 'https://www.coolblue.be/x' }), t)).toBe('coolblue.be')
  })

  it('names who bought, and leaves what is left to the stepper', () => {
    const line = wishLine(buyer(4, [
      { name: 'Moeke', quantity: 1, mine: false },
      { name: 'Art', quantity: 2, mine: true },
    ]), t)
    expect(line).toBe('Moeke 1 · [purchase.you] 2')
  })

  it('leaves the numbers out next to the names when only one was asked for', () => {
    expect(wishLine(buyer(1, [{ name: 'Moeke', quantity: 1, mine: false }]), t)).toBe('Moeke')
  })

  it('says nothing about what is left to a buyer when the wish is unlimited', () => {
    expect(wishLine(buyer(null, [{ name: 'Moeke', quantity: 5, mine: false }]), t)).toBe('Moeke 5')
  })

  it('never says something is left on a removed wish', () => {
    for (const quantity of [1, 3, null]) {
      const line = wishLine(buyer(quantity, [{ name: 'Moeke', quantity: 1, mine: false }], { removed: true }), t)
      expect(line).not.toContain('wish.left')
      expect(line).toContain('Moeke')
    }
  })
})

function anon(extra: Partial<AnonWish> = {}): AnonWish {
  return { ...base, role: 'anon', quantity: 1, sharedWith: [], ...extra }
}

describe('the tag that says whose wish it is too', () => {
  it('names the owners who are not on this list, for everyone who sees the row', () => {
    const lotte = { sharedWith: ['Lotte'] }
    expect(wishOwnerTag(buyer(1, [], lotte), false)).toEqual({ key: 'wish.with', names: ['Lotte'] })
    expect(wishOwnerTag(anon(lotte), false)).toEqual({ key: 'wish.with', names: ['Lotte'] })
    // The owner of this list sees it on their own list.
    expect(wishOwnerTag(owner(1, 0, lotte), true)).toEqual({ key: 'wish.with', names: ['Lotte'] })
    expect(wishOwnerTag(buyer(1, [], { sharedWith: ['Lotte', 'Sam'] }), false))
      .toEqual({ key: 'wish.with', names: ['Lotte', 'Sam'] })
  })

  it('names the others before saying it is yours, on a list that is not yours', () => {
    expect(wishOwnerTag(owner(1, 0, { sharedWith: ['Sam'] }), false)).toEqual({ key: 'wish.with', names: ['Sam'] })
  })

  it('says "also yours" to an owner of the wish on someone else\'s list', () => {
    expect(wishOwnerTag(owner(1, 0), false)).toEqual({ key: 'wish.alsoYours' })
    expect(wishOwnerTag(owner(3, 2), false)).toEqual({ key: 'wish.alsoYours' })
  })

  it("has no tag for a wish of this list's owners only", () => {
    expect(wishOwnerTag(owner(1, 0), true)).toBeNull()
    expect(wishOwnerTag(anon(), false)).toBeNull()
  })

  it('has no tag for a buyer of a plain wish', () => {
    expect(wishOwnerTag(buyer(1, [{ name: 'Moeke', quantity: 1, mine: false }]), false)).toBeNull()
  })

  it('has no tag on a wish that was taken off this list', () => {
    expect(wishOwnerTag(buyer(1, [{ name: 'Moeke', quantity: 1, mine: false }], { removed: true, sharedWith: ['Lotte'] }), false)).toBeNull()
  })
})
