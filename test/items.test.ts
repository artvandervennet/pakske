import { describe, expect, it } from 'vitest'
import { createItem, deleteItem, setItemImage, updateItem } from '../server/domain/items'
import { listPublicItems } from '../server/domain/public-list'
import { setPurchase } from '../server/domain/purchases'
import { addItem, addUser, codeOf, makeDb } from './helpers'

describe('the owner manages wishes', () => {
  it('adds a wish to the list, with an amount of 1 unless told otherwise', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    createItem(db, art.id, { title: 'Puzzel', description: '1000 stukjes', url: 'https://example.test/p', quantity: 1 })
    expect(listPublicItems(db, art.id)).toMatchObject([
      { title: 'Puzzel', description: '1000 stukjes', url: 'https://example.test/p', quantity: 1, image: null },
    ])
  })

  it('keeps an unlimited amount as null', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    addItem(db, art.id, 'Puzzels', null)
    expect(listPublicItems(db, art.id)[0]!.quantity).toBeNull()
  })

  it('changes a wish', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    const item = addItem(db, art.id, 'Slimme stekker', 1)
    const updated = updateItem(db, art.id, item.id, { title: 'Slimme stekkers', description: null, url: null, quantity: 3 })
    expect(updated).toMatchObject({ title: 'Slimme stekkers', quantity: 3 })
  })

  it('does not let someone else change or delete a wish', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    const mom = addUser(db, 'mom')
    const item = addItem(db, art.id, 'Boek')
    expect(codeOf(() => updateItem(db, mom.id, item.id, { title: 'x', description: null, url: null, quantity: 1 }))).toBe('not_found')
    expect(codeOf(() => deleteItem(db, mom.id, item.id))).toBe('not_found')
  })

  it('takes a deleted wish off the list, and a second delete finds nothing', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    const item = addItem(db, art.id, 'Boek')
    deleteItem(db, art.id, item.id)
    expect(listPublicItems(db, art.id)).toEqual([])
    expect(codeOf(() => deleteItem(db, art.id, item.id))).toBe('not_found')
  })

  it('sets and clears the image, and reports the file it replaced', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    const item = addItem(db, art.id, 'Boek')
    expect(setItemImage(db, art.id, item.id, 'a.jpg')).toEqual({ previous: null })
    expect(listPublicItems(db, art.id)[0]!.image).toBe('/uploads/a.jpg')
    expect(setItemImage(db, art.id, item.id, null)).toEqual({ previous: 'a.jpg' })
    expect(listPublicItems(db, art.id)[0]!.image).toBeNull()
  })

  it('refuses a new wish when the list is full', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    addItem(db, art.id, 'Een')
    const oneTooMany = () => createItem(db, art.id, { title: 'Twee', description: null, url: null, quantity: 1 }, { maxItems: 1 })
    expect(codeOf(oneTooMany)).toBe('item_limit')
  })

  it('lets the owner lower the amount below what is already bought, without a word', () => {
    const db = makeDb()
    const art = addUser(db, 'art')
    const mom = addUser(db, 'mom')
    const item = addItem(db, art.id, 'Slimme stekkers', 3)
    setPurchase(db, item.id, mom.id, 3)
    const updated = updateItem(db, art.id, item.id, { title: 'Slimme stekkers', description: null, url: null, quantity: 2 })
    expect(updated.quantity).toBe(2)
  })
})
