import { describe, expect, it } from 'vitest'
import { getListView } from '../server/domain/list-view'
import { deleteList, ownedListId } from '../server/domain/lists'
import { putOnList } from '../server/domain/placement'
import { removePurchase, setPurchase } from '../server/domain/purchases'
import { deleteWish, updateWish } from '../server/domain/wishes'
import { purchaseInput, wishInput } from '../shared/schemas/input'
import { addList, addUser, addWishTo, codeOf, makeDb, purchaseRows } from './helpers'

function setup(quantity: number | null = 3) {
  const db = makeDb()
  const art = addUser(db, 'art')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const token = addList(db, art.id)
  const wish = addWishTo(db, art.id, token, 'Slimme stekkers', quantity)
  const bought = () => purchaseRows(db, wish.id).reduce((sum, row) => sum + row.quantity, 0)
  return { db, art, mom, sis, token, wish, bought }
}

describe('buying', () => {
  it('adds up what different people buy', () => {
    const { db, token, wish, mom, sis, bought } = setup(3)
    setPurchase(db, token, wish.id, mom.id, 2)
    setPurchase(db, token, wish.id, sis.id, 1)
    expect(bought()).toBe(3)
  })

  it('refuses more than the amount asked for', () => {
    const { db, token, wish, mom, sis, bought } = setup(3)
    setPurchase(db, token, wish.id, mom.id, 2)
    expect(codeOf(() => setPurchase(db, token, wish.id, sis.id, 2))).toBe('quantity_exceeded')
    expect(bought()).toBe(2)
  })

  it('has no ceiling on an unlimited wish', () => {
    const { db, token, wish, mom, sis, bought } = setup(null)
    setPurchase(db, token, wish.id, mom.id, 40)
    setPurchase(db, token, wish.id, sis.id, 60)
    expect(bought()).toBe(100)
  })

  it('replaces a buyer\'s earlier amount instead of adding to it', () => {
    const { db, token, wish, mom, bought } = setup(3)
    setPurchase(db, token, wish.id, mom.id, 1)
    setPurchase(db, token, wish.id, mom.id, 3)
    expect(bought()).toBe(3)
    expect(purchaseRows(db, wish.id)).toHaveLength(1)
  })

  it('counts only the other buyers against the ceiling when a buyer changes their amount', () => {
    const { db, token, wish, mom, sis } = setup(3)
    setPurchase(db, token, wish.id, mom.id, 2)
    setPurchase(db, token, wish.id, sis.id, 1)
    expect(codeOf(() => setPurchase(db, token, wish.id, mom.id, 3))).toBe('quantity_exceeded')
    expect(codeOf(() => setPurchase(db, token, wish.id, mom.id, 1))).toBeUndefined()
  })

  it('removes a purchase', () => {
    const { db, token, wish, mom, bought } = setup(3)
    setPurchase(db, token, wish.id, mom.id, 2)
    removePurchase(db, token, wish.id, mom.id)
    expect(bought()).toBe(0)
  })

  it('refuses amounts below 1 and fractions', () => {
    const { db, token, wish, mom } = setup(3)
    expect(codeOf(() => setPurchase(db, token, wish.id, mom.id, 0))).toBe('validation')
    expect(codeOf(() => setPurchase(db, token, wish.id, mom.id, 1.5))).toBe('validation')
  })

  describe('an owner ticking their own wish', () => {
    it('records it like any purchase when the wish is free', () => {
      const { db, token, wish, art } = setup(1)
      setPurchase(db, token, wish.id, art.id, 1)
      expect(purchaseRows(db, wish.id)).toEqual([{ userId: art.id, quantity: 1 }])
    })

    it('is refused, with the same code a buyer gets, when someone already has it', () => {
      const { db, token, wish, art, mom } = setup(1)
      setPurchase(db, token, wish.id, mom.id, 1)
      expect(codeOf(() => setPurchase(db, token, wish.id, art.id, 1))).toBe('quantity_exceeded')
    })

    it('can always be undone', () => {
      const { db, token, wish, art } = setup(1)
      setPurchase(db, token, wish.id, art.id, 1)
      deleteWish(db, art.id, token, wish.id)
      removePurchase(db, token, wish.id, art.id)
      expect(purchaseRows(db, wish.id)).toEqual([])
    })
  })

  describe('through the wrong door', () => {
    it('finds nothing through a list that does not show the wish', () => {
      const { db, wish, art, mom } = setup()
      const other = addList(db, art.id, 'Verjaardag')
      expect(codeOf(() => setPurchase(db, other, wish.id, mom.id, 1))).toBe('not_found')
      expect(codeOf(() => removePurchase(db, other, wish.id, mom.id))).toBe('not_found')
    })

    it('finds nothing for a token that matches no list', () => {
      const { db, wish, mom } = setup()
      expect(codeOf(() => setPurchase(db, 'no-such-token', wish.id, mom.id, 1))).toBe('not_found')
      expect(codeOf(() => removePurchase(db, 'no-such-token', wish.id, mom.id))).toBe('not_found')
    })

    it('finds nothing for a wish that does not exist', () => {
      const { db, token, mom } = setup()
      expect(codeOf(() => setPurchase(db, token, 9999, mom.id, 1))).toBe('not_found')
      expect(codeOf(() => removePurchase(db, token, 9999, mom.id))).toBe('not_found')
    })
  })

  describe('after the owner lowered the amount below what is bought', () => {
    function oversubscribed() {
      const s = setup(3)
      setPurchase(s.db, s.token, s.wish.id, s.mom.id, 2)
      setPurchase(s.db, s.token, s.wish.id, s.sis.id, 1)
      updateWish(s.db, s.art.id, s.token, s.wish.id, wishInput.parse({ title: 'Slimme stekkers', quantity: 2 }))
      return s
    }

    it('keeps the purchases as they were', () => {
      expect(oversubscribed().bought()).toBe(3)
    })

    it('lets a buyer lower their amount, and refuses an increase', () => {
      const { db, token, wish, mom, sis } = oversubscribed()
      expect(codeOf(() => setPurchase(db, token, wish.id, sis.id, 2))).toBe('quantity_exceeded')
      expect(codeOf(() => setPurchase(db, token, wish.id, mom.id, 1))).toBeUndefined()
    })
  })

  describe('on a wish the owner took off the list', () => {
    it('lets a buyer lower or remove their amount, and refuses new or larger purchases', () => {
      const { db, art, token, wish, mom, sis } = setup(3)
      setPurchase(db, token, wish.id, mom.id, 2)
      deleteWish(db, art.id, token, wish.id)
      expect(codeOf(() => setPurchase(db, token, wish.id, sis.id, 1))).toBe('wish_removed')
      expect(codeOf(() => setPurchase(db, token, wish.id, mom.id, 3))).toBe('wish_removed')
      expect(codeOf(() => setPurchase(db, token, wish.id, mom.id, 1))).toBeUndefined()
      expect(codeOf(() => removePurchase(db, token, wish.id, mom.id))).toBeUndefined()
    })

    it('treats removing nothing as success, for someone with no purchase', () => {
      const { db, art, token, wish, sis } = setup(3)
      deleteWish(db, art.id, token, wish.id)
      expect(codeOf(() => removePurchase(db, token, wish.id, sis.id))).toBeUndefined()
    })

    it('answers an increase the same whether or not anyone bought it', () => {
      const bought = setup(1)
      setPurchase(bought.db, bought.token, bought.wish.id, bought.mom.id, 1)
      deleteWish(bought.db, bought.art.id, bought.token, bought.wish.id)
      const unbought = setup(1)
      deleteWish(unbought.db, unbought.art.id, unbought.token, unbought.wish.id)
      // Without the early check the first would say quantity_exceeded and the second would succeed.
      expect(codeOf(() => setPurchase(bought.db, bought.token, bought.wish.id, bought.art.id, 1))).toBe('wish_removed')
      expect(codeOf(() => setPurchase(unbought.db, unbought.token, unbought.wish.id, unbought.art.id, 1))).toBe('wish_removed')
    })
  })

  describe('on a joint wish taken off one of its lists', () => {
    /** The wish is on Art's list and Lotte's; Art takes it off his. With `bought`, mom had one through his. */
    function takenOff(bought: boolean) {
      const s = setup(3)
      const lot = addUser(s.db, 'lotte')
      const theirs = addList(s.db, lot.id, 'Verjaardag')
      putOnList(s.db, ownedListId(s.db, lot.id, theirs), s.wish.id)
      if (bought) setPurchase(s.db, s.token, s.wish.id, s.mom.id, 2)
      deleteWish(s.db, s.art.id, s.token, s.wish.id)
      return { ...s, lot, theirs }
    }

    it('answers an increase through the list it left with wish_removed, whether or not anyone bought it', () => {
      for (const bought of [false, true]) {
        const { db, token, wish, art, lot, sis } = takenOff(bought)
        for (const who of [sis, art, lot]) {
          expect(codeOf(() => setPurchase(db, token, wish.id, who.id, 1)), `${who.displayName}, bought ${bought}`).toBe('wish_removed')
        }
      }
    })

    it('lets a buyer lower and remove their purchase through the list it left', () => {
      const { db, token, wish, mom } = takenOff(true)
      expect(codeOf(() => setPurchase(db, token, wish.id, mom.id, 3))).toBe('wish_removed')
      expect(codeOf(() => setPurchase(db, token, wish.id, mom.id, 1))).toBeUndefined()
      expect(purchaseRows(db, wish.id)).toEqual([{ userId: mom.id, quantity: 1 }])
      expect(codeOf(() => removePurchase(db, token, wish.id, mom.id))).toBeUndefined()
      expect(purchaseRows(db, wish.id)).toEqual([])
    })

    it('still sells it through the list that shows it, counting what was bought through the other', () => {
      const { db, theirs, wish, mom, sis } = takenOff(true)
      setPurchase(db, theirs, wish.id, sis.id, 1)
      expect(codeOf(() => setPurchase(db, theirs, wish.id, sis.id, 2))).toBe('quantity_exceeded')
      setPurchase(db, theirs, wish.id, mom.id, 1)
      expect(purchaseRows(db, wish.id)).toEqual([{ userId: mom.id, quantity: 1 }, { userId: sis.id, quantity: 1 }])
    })
  })

  describe('on a deleted list', () => {
    it('still resolves by its token: lowering and removing work, any increase is wish_removed', () => {
      const { db, art, token, wish, mom, sis } = setup(1)
      setPurchase(db, token, wish.id, mom.id, 1)
      deleteList(db, art.id, token)
      expect(codeOf(() => setPurchase(db, token, wish.id, sis.id, 1))).toBe('wish_removed')
      expect(codeOf(() => setPurchase(db, token, wish.id, art.id, 1))).toBe('wish_removed')
      expect(codeOf(() => removePurchase(db, token, wish.id, sis.id))).toBeUndefined()
      expect(codeOf(() => removePurchase(db, token, wish.id, mom.id))).toBeUndefined()
      expect(purchaseRows(db, wish.id)).toEqual([])
    })
  })
})

describe('buying without your name', () => {
  const purchasesSeenBy = (db: ReturnType<typeof makeDb>, token: string, wishId: number, userId: number) => {
    const wish = getListView(db, token, userId)!.wishes.find(w => w.id === wishId)!
    return wish.role === 'buyer' ? wish.purchases : []
  }

  it('hides the name from the other buyers', () => {
    const { db, token, wish, mom, sis } = setup(3)
    setPurchase(db, token, wish.id, mom.id, 2, true)
    expect(purchasesSeenBy(db, token, wish.id, sis.id)).toEqual([{ name: null, quantity: 2, mine: false, anonymous: true }])
    expect(JSON.stringify(getListView(db, token, sis.id))).not.toContain('Mom')
  })

  it('shows the buyer their own purchase, marked as anonymous', () => {
    const { db, token, wish, mom } = setup(3)
    setPurchase(db, token, wish.id, mom.id, 2, true)
    expect(purchasesSeenBy(db, token, wish.id, mom.id)).toEqual([{ name: 'Mom', quantity: 2, mine: true, anonymous: true }])
  })

  it('keeps the choice when only the number changes, and changes it when asked', () => {
    const { db, token, wish, mom, sis } = setup(3)
    setPurchase(db, token, wish.id, mom.id, 1, true)
    setPurchase(db, token, wish.id, mom.id, 2)
    expect(purchasesSeenBy(db, token, wish.id, sis.id)).toMatchObject([{ name: null, quantity: 2, anonymous: true }])
    setPurchase(db, token, wish.id, mom.id, 2, false)
    expect(purchasesSeenBy(db, token, wish.id, sis.id)).toMatchObject([{ name: 'Mom', quantity: 2, anonymous: false }])
  })

  it('gives the owner and a logged-out visitor the same list either way', () => {
    const { db, token, wish, art, mom } = setup(3)
    setPurchase(db, token, wish.id, mom.id, 1, false)
    const owner = getListView(db, token, art.id)
    const visitor = getListView(db, token, null)
    setPurchase(db, token, wish.id, mom.id, 1, true)
    expect(getListView(db, token, art.id)).toEqual(owner)
    expect(getListView(db, token, null)).toEqual(visitor)
  })

  it('shows names by default', () => {
    const { db, token, wish, mom, sis } = setup(3)
    setPurchase(db, token, wish.id, mom.id, 1)
    expect(purchasesSeenBy(db, token, wish.id, sis.id)).toEqual([{ name: 'Mom', quantity: 1, mine: false, anonymous: false }])
  })

  it('takes the choice from the request', () => {
    expect(purchaseInput.parse({ quantity: 1, anonymous: true })).toEqual({ quantity: 1, anonymous: true })
    expect(purchaseInput.parse({ quantity: 1 })).toEqual({ quantity: 1 })
  })
})
