import { describe, expect, it } from 'vitest'
import type { AnonWish, BuyerWish, OwnerWish } from '../shared/schemas/list'
import { canRaise, isCheckedOff, needsWarning, tickCeiling, tickRefusal, tickState } from '../shared/utils/wish-tick'

const base = {
  id: 1,
  title: 'Slimme stekkers',
  description: null,
  url: null,
  image: null,
  createdAt: '2026-11-17T10:00:00.000Z',
  updatedAt: '2026-11-17T10:00:00.000Z',
}

function owner(quantity: number | null, mine: number): OwnerWish {
  return { ...base, role: 'owner', quantity, mine, sharedWith: [], coOwners: [], alsoElsewhere: false }
}

function buyer(quantity: number | null, bought: number, mine: number, extra: Partial<BuyerWish> = {}): BuyerWish {
  return { ...base, role: 'buyer', quantity, sharedWith: [], removed: false, bought, mine, purchases: [], notes: [], ...extra }
}

const anon: AnonWish = { ...base, role: 'anon', quantity: 1, sharedWith: [] }

describe('who may raise their number', () => {
  it('lets an owner raise, whatever the numbers on the wish', () => {
    for (const quantity of [1, 3, null]) {
      for (const mine of [0, 1, 3, 5]) {
        expect(canRaise(owner(quantity, mine), mine)).toBe(true)
        expect(canRaise(owner(quantity, mine), mine + 1)).toBe(true)
      }
    }
  })

  it("doesn't let a buyer raise when nothing is left", () => {
    expect(canRaise(buyer(1, 1, 0), 0)).toBe(false)
    expect(canRaise(buyer(3, 3, 1), 1)).toBe(false)
    // Someone else bought more than was asked; still nothing to take.
    expect(canRaise(buyer(2, 4, 0), 0)).toBe(false)
  })

  it('counts what the buyer just asked for before the list catches up', () => {
    // Bought 2 of 3, one of them theirs; they asked for a second, so nothing is left.
    expect(canRaise(buyer(3, 2, 1), 1)).toBe(true)
    expect(canRaise(buyer(3, 2, 1), 2)).toBe(false)
  })

  it('lets a buyer raise while something is left, or when there is no limit', () => {
    expect(canRaise(buyer(1, 0, 0), 0)).toBe(true)
    expect(canRaise(buyer(3, 2, 0), 0)).toBe(true)
    expect(canRaise(buyer(null, 40, 3), 3)).toBe(true)
  })

  it("doesn't let a buyer raise on a removed wish, even with plenty left", () => {
    for (const quantity of [1, 5, null]) {
      expect(canRaise(buyer(quantity, 0, 0, { removed: true }), 0)).toBe(false)
    }
  })

  it("doesn't let a visitor who isn't logged in raise", () => {
    expect(canRaise(anon, 0)).toBe(false)
  })
})

describe('the warning before an increase', () => {
  it("is always needed for an owner's increase and never for a decrease", () => {
    for (const quantity of [1, 3, null]) {
      expect(needsWarning(owner(quantity, 0), 0, 1)).toBe(true)
      expect(needsWarning(owner(quantity, 2), 2, 3)).toBe(true)
      expect(needsWarning(owner(quantity, 2), 2, 1)).toBe(false)
      expect(needsWarning(owner(quantity, 1), 1, 0)).toBe(false)
    }
  })

  it('is never needed for a buyer', () => {
    expect(needsWarning(buyer(3, 0, 0), 0, 1)).toBe(false)
    expect(needsWarning(buyer(3, 1, 1), 1, 0)).toBe(false)
  })
})

describe('the words for a refusal', () => {
  it('depend only on the error code and on whether the wish is wanted once', () => {
    expect(tickRefusal('quantity_exceeded', true)).toEqual({ key: 'tick.taken', gone: false })
    expect(tickRefusal('quantity_exceeded', false)).toEqual({ key: 'tick.notEnough', gone: false })
    for (const once of [true, false]) {
      expect(tickRefusal('wish_removed', once)).toEqual({ key: 'tick.removed', gone: true })
      expect(tickRefusal('not_found', once)).toEqual({ key: 'tick.gone', gone: true })
    }
  })

  it('leave any other error to its own sentence', () => {
    expect(tickRefusal('rate_limited', true)).toBeNull()
    expect(tickRefusal('unknown', false)).toBeNull()
  })
})

describe("a wish's tick state", () => {
  it('changes with the numbers that decide a tick', () => {
    const before = buyer(3, 1, 0)
    expect(tickState(buyer(3, 2, 0))).not.toBe(tickState(before))
    expect(tickState(buyer(3, 1, 1))).not.toBe(tickState(before))
    expect(tickState(buyer(2, 1, 0))).not.toBe(tickState(before))
    expect(tickState(buyer(3, 1, 0, { removed: true }))).not.toBe(tickState(before))
    expect(tickState(owner(3, 1))).not.toBe(tickState(owner(3, 0)))
  })

  it("stays the same when only the wish's words change", () => {
    expect(tickState(buyer(3, 1, 0, { title: 'Iets anders', description: 'Rood' }))).toBe(tickState(buyer(3, 1, 0)))
  })
})

describe('the number after the slash in the stepper', () => {
  it('shows a buyer the most they can get: their own and what is left', () => {
    expect(tickCeiling(buyer(4, 2, 0))).toBe(2)
    expect(tickCeiling(buyer(4, 3, 1))).toBe(2)
    expect(tickCeiling(buyer(4, 0, 0))).toBe(4)
    expect(tickCeiling(buyer(4, 4, 4))).toBe(4)
  })

  it('never shows a buyer less than they have, even when others bought too many', () => {
    expect(tickCeiling(buyer(2, 4, 0))).toBe(0)
    expect(tickCeiling(buyer(2, 4, 1))).toBe(1)
  })

  it('shows a buyer of a removed wish only what they have', () => {
    expect(tickCeiling(buyer(4, 1, 1, { removed: true }))).toBe(1)
  })

  it('shows an owner what was asked for, never what is left', () => {
    for (const mine of [0, 1, 3]) expect(tickCeiling(owner(4, mine))).toBe(4)
  })

  it('has no number for an unlimited wish', () => {
    expect(tickCeiling(buyer(null, 3, 1))).toBeNull()
    expect(tickCeiling(owner(null, 0))).toBeNull()
  })
})

describe('when a row shows as checked off', () => {
  it('checks it off for a buyer once everything asked for is taken, by anyone', () => {
    expect(isCheckedOff(buyer(1, 1, 0))).toBe(true)
    expect(isCheckedOff(buyer(1, 1, 1))).toBe(true)
    expect(isCheckedOff(buyer(3, 3, 1))).toBe(true)
    expect(isCheckedOff(buyer(2, 4, 0))).toBe(true)
  })

  it('leaves it open for a buyer while some are left, or when there is no limit', () => {
    expect(isCheckedOff(buyer(1, 0, 0))).toBe(false)
    expect(isCheckedOff(buyer(3, 2, 2))).toBe(false)
    expect(isCheckedOff(buyer(null, 9, 1))).toBe(false)
  })

  it('leaves a wish taken off the list to its own tag', () => {
    expect(isCheckedOff(buyer(1, 1, 1, { removed: true }))).toBe(false)
  })

  it('checks it off for an owner only by what they ticked themselves', () => {
    expect(isCheckedOff(owner(1, 1))).toBe(true)
    expect(isCheckedOff(owner(3, 3))).toBe(true)
    expect(isCheckedOff(owner(3, 2))).toBe(false)
    expect(isCheckedOff(owner(1, 0))).toBe(false)
    expect(isCheckedOff(owner(null, 4))).toBe(false)
  })

  it('never checks it off for a visitor who is not logged in', () => {
    expect(isCheckedOff(anon)).toBe(false)
  })
})
