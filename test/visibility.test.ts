import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Db } from '../server/db/client'
import { deleteItem, updateItem } from '../server/domain/items'
import { getList } from '../server/domain/list'
import { addNote } from '../server/domain/notes'
import { listDirectory, listPublicItems } from '../server/domain/public-list'
import { setPurchase } from '../server/domain/purchases'
import { resolveViewer } from '../server/domain/viewer'
import { buyerItemSchema, ownerSchema, publicItemSchema } from '../shared/schemas/list'
import { addItem, addUser, makeDb } from './helpers'

// One clock for every database, so two of them built the same way are equal to the millisecond.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

/**
 * Art's list with four wishes, one of them deleted. With `buyersActive`, mom and sis buy, leave
 * notes, and the deleted wish is one somebody had bought. Everything the buyers do is the only
 * difference between the two worlds.
 */
function world(buyersActive: boolean) {
  const db = makeDb()
  const art = addUser(db, 'art')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const plugs = addItem(db, art.id, 'Slimme stekkers', 3)
  const puzzles = addItem(db, art.id, 'Puzzels', null)
  const book = addItem(db, art.id, 'Boek', 1)
  const socks = addItem(db, art.id, 'Sokken', 1)

  if (buyersActive) {
    vi.advanceTimersByTime(60_000)
    setPurchase(db, plugs.id, mom.id, 2)
    setPurchase(db, plugs.id, sis.id, 1)
    setPurchase(db, puzzles.id, sis.id, 4)
    setPurchase(db, socks.id, mom.id, 1)
    addNote(db, plugs.id, mom.id, 'Ik neem er twee.')
    addNote(db, socks.id, mom.id, 'Al gekocht!')
    vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
  }

  // What the owner does afterwards, the same in both worlds.
  vi.advanceTimersByTime(3_600_000)
  updateItem(db, art.id, plugs.id, { title: 'Slimme stekkers', description: 'Zigbee', url: null, quantity: 2 })
  deleteItem(db, art.id, socks.id)
  vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))

  return { db, art, mom, sis, plugs, puzzles, book, socks }
}

const ownerView = (db: Db, ownerId: number) => getList(db, 'art', ownerId)
const anonView = (db: Db) => getList(db, 'art', null)

describe('who a viewer is', () => {
  it('is decided from the session and the owner of the list', () => {
    expect(resolveViewer(null, 1)).toBe('anon')
    expect(resolveViewer(1, 1)).toBe('owner')
    expect(resolveViewer(2, 1)).toBe('buyer')
  })
})

describe('the owner and visitors who are not logged in', () => {
  it('get exactly the same list whether or not anyone bought or wrote anything', () => {
    const quiet = world(false)
    const busy = world(true)
    expect(ownerView(busy.db, busy.art.id)).toEqual(ownerView(quiet.db, quiet.art.id))
    expect(anonView(busy.db)).toEqual(anonView(quiet.db))
    expect(listDirectory(busy.db)).toEqual(listDirectory(quiet.db))
    expect(listPublicItems(busy.db, busy.art.id)).toEqual(listPublicItems(quiet.db, quiet.art.id))
  })

  it('get items with no field about purchases or notes', () => {
    const { db, art } = world(true)
    const strictList = z.strictObject({
      viewer: z.enum(['anon', 'owner']),
      owner: ownerSchema,
      items: z.array(publicItemSchema),
    })
    expect(() => strictList.parse(ownerView(db, art.id))).not.toThrow()
    expect(() => strictList.parse(anonView(db))).not.toThrow()
    expect(ownerView(db, art.id)!.viewer).toBe('owner')
    expect(anonView(db)!.viewer).toBe('anon')
  })

  it('do not see a deleted wish, bought or not', () => {
    const { db, art } = world(true)
    expect(ownerView(db, art.id)!.items.map(i => i.title)).toEqual(['Slimme stekkers', 'Puzzels', 'Boek'])
  })

  it('get nothing in the JSON that names a buyer or quotes a note', () => {
    const { db, art } = world(true)
    // The list itself: the buyers' names must not be in it. (The directory of all lists does
    // name everyone, so it is checked without the names.)
    const lists = JSON.stringify([ownerView(db, art.id), anonView(db)])
    for (const secret of ['Mom', 'Sis', 'Ik neem er twee', 'Al gekocht', 'purchases', 'notes', 'bought', 'removed']) {
      expect(lists).not.toContain(secret)
    }
    const directory = JSON.stringify(listDirectory(db))
    for (const secret of ['Ik neem er twee', 'Al gekocht', 'purchases', 'notes', 'bought', 'removed']) {
      expect(directory).not.toContain(secret)
    }
  })
})

describe('a logged-in visitor who is not the owner', () => {
  it('sees who bought how many, and which purchase is their own', () => {
    const { db, mom, plugs } = world(true)
    const list = getList(db, 'art', mom.id)!
    expect(list.viewer).toBe('buyer')
    const item = z.array(buyerItemSchema).parse(list.items).find(i => i.id === plugs.id)!
    expect(item.bought).toBe(3)
    expect(item.purchases).toEqual([
      { name: 'Mom', quantity: 2, mine: true },
      { name: 'Sis', quantity: 1, mine: false },
    ])
    expect(item.notes).toMatchObject([{ author: 'Mom', body: 'Ik neem er twee.', mine: true }])
  })

  it('still sees a wish the owner deleted after someone bought it, marked as removed', () => {
    const { db, sis, socks } = world(true)
    const item = getList(db, 'art', sis.id)!.items.find(i => i.id === socks.id)
    expect(item).toMatchObject({ title: 'Sokken', removed: true, bought: 1 })
  })

  it('does not see a deleted wish nobody bought', () => {
    const { db, sis, socks } = world(false)
    expect(getList(db, 'art', sis.id)!.items.map(i => i.id)).not.toContain(socks.id)
  })
})

describe('a list that does not exist', () => {
  it('is undefined for everyone', () => {
    const { db, mom } = world(false)
    expect(getList(db, 'nobody', null)).toBeUndefined()
    expect(getList(db, 'nobody', mom.id)).toBeUndefined()
  })
})

describe('the code that serves the owner', () => {
  // The owner's and the public's path must not be able to read buyer data at all.
  it.each(['server/domain/public-list.ts', 'server/domain/items.ts'])('%s never touches purchases or notes', (file) => {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/purchases|notes/i)
  })
})
