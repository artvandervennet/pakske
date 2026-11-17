import { describe, expect, it } from 'vitest'
import { listBuyerItems } from '../server/domain/buyer-list'
import { deleteItem, updateItem } from '../server/domain/items'
import { removePurchase, setPurchase } from '../server/domain/purchases'
import { addItem, addUser, codeOf, makeDb } from './helpers'

function setup(quantity: number | null = 3) {
  const db = makeDb()
  const art = addUser(db, 'art')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const item = addItem(db, art.id, 'Slimme stekkers', quantity)
  const bought = () => listBuyerItems(db, art.id, mom.id).find(i => i.id === item.id)?.bought
  return { db, art, mom, sis, item, bought }
}

describe('buying', () => {
  it('adds up what different people buy', () => {
    const { db, mom, sis, item, bought } = setup(3)
    setPurchase(db, item.id, mom.id, 2)
    setPurchase(db, item.id, sis.id, 1)
    expect(bought()).toBe(3)
  })

  it('refuses more than the amount asked for', () => {
    const { db, mom, sis, item, bought } = setup(3)
    setPurchase(db, item.id, mom.id, 2)
    expect(codeOf(() => setPurchase(db, item.id, sis.id, 2))).toBe('quantity_exceeded')
    expect(bought()).toBe(2)
  })

  it('has no ceiling on an unlimited wish', () => {
    const { db, mom, sis, item, bought } = setup(null)
    setPurchase(db, item.id, mom.id, 40)
    setPurchase(db, item.id, sis.id, 60)
    expect(bought()).toBe(100)
  })

  it('replaces a buyer\'s earlier amount instead of adding to it', () => {
    const { db, mom, item, bought } = setup(3)
    setPurchase(db, item.id, mom.id, 1)
    setPurchase(db, item.id, mom.id, 3)
    expect(bought()).toBe(3)
  })

  it('counts only the other buyers against the ceiling when a buyer changes their amount', () => {
    const { db, mom, sis, item } = setup(3)
    setPurchase(db, item.id, mom.id, 2)
    setPurchase(db, item.id, sis.id, 1)
    expect(codeOf(() => setPurchase(db, item.id, mom.id, 3))).toBe('quantity_exceeded')
    expect(codeOf(() => setPurchase(db, item.id, mom.id, 1))).toBeUndefined()
  })

  it('removes a purchase', () => {
    const { db, mom, item, bought } = setup(3)
    setPurchase(db, item.id, mom.id, 2)
    removePurchase(db, item.id, mom.id)
    expect(bought()).toBe(0)
  })

  it('refuses the owner on their own wish, whatever its state', () => {
    const { db, art, mom, item } = setup(1)
    expect(codeOf(() => setPurchase(db, item.id, art.id, 1))).toBe('forbidden')
    setPurchase(db, item.id, mom.id, 1)
    expect(codeOf(() => setPurchase(db, item.id, art.id, 1))).toBe('forbidden')
    deleteItem(db, art.id, item.id)
    expect(codeOf(() => setPurchase(db, item.id, art.id, 1))).toBe('forbidden')
    expect(codeOf(() => removePurchase(db, item.id, art.id))).toBe('forbidden')
  })

  it('finds nothing for a wish that does not exist', () => {
    const { db, mom } = setup()
    expect(codeOf(() => setPurchase(db, 9999, mom.id, 1))).toBe('not_found')
    expect(codeOf(() => removePurchase(db, 9999, mom.id))).toBe('not_found')
  })

  it('refuses amounts below 1 and fractions', () => {
    const { db, mom, item } = setup(3)
    expect(codeOf(() => setPurchase(db, item.id, mom.id, 0))).toBe('validation')
    expect(codeOf(() => setPurchase(db, item.id, mom.id, 1.5))).toBe('validation')
  })

  describe('after the owner lowered the amount below what is bought', () => {
    function oversubscribed() {
      const s = setup(3)
      setPurchase(s.db, s.item.id, s.mom.id, 2)
      setPurchase(s.db, s.item.id, s.sis.id, 1)
      updateItem(s.db, s.art.id, s.item.id, { title: 'Slimme stekkers', description: null, url: null, quantity: 2 })
      return s
    }

    it('keeps the purchases as they were', () => {
      const { bought } = oversubscribed()
      expect(bought()).toBe(3)
    })

    it('lets a buyer lower their amount, and refuses an increase', () => {
      const { db, mom, sis, item } = oversubscribed()
      expect(codeOf(() => setPurchase(db, item.id, sis.id, 2))).toBe('quantity_exceeded')
      expect(codeOf(() => setPurchase(db, item.id, mom.id, 1))).toBeUndefined()
    })
  })

  describe('on a wish the owner took off the list', () => {
    it('lets a buyer lower or remove their amount, and refuses new or larger purchases', () => {
      const { db, art, mom, sis, item } = setup(3)
      setPurchase(db, item.id, mom.id, 2)
      deleteItem(db, art.id, item.id)
      expect(codeOf(() => setPurchase(db, item.id, sis.id, 1))).toBe('item_removed')
      expect(codeOf(() => setPurchase(db, item.id, mom.id, 3))).toBe('item_removed')
      expect(codeOf(() => setPurchase(db, item.id, mom.id, 1))).toBeUndefined()
      expect(codeOf(() => removePurchase(db, item.id, mom.id))).toBeUndefined()
    })
  })
})
