import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { listWishes, wishes } from '../server/db/schema'
import { ownedListId } from '../server/domain/lists'
import { assertRoom, putOnList, standing, takeOffList, wishOnList } from '../server/domain/placement'
import { addList, addOwner, addUser, addWishTo, codeOf, expectOwnersSettled, makeDb, ownerIds } from './helpers'

function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lot = addUser(db, 'lot')
  const sam = addUser(db, 'sam')
  const A = addList(db, art.id, 'Kerst')
  const L = addList(db, lot.id, 'Verjaardag')
  return { db, art, lot, sam, A, L, aId: ownedListId(db, art.id, A), lId: ownedListId(db, lot.id, L) }
}

const deletedAt = (db: ReturnType<typeof setup>['db'], wishId: number) =>
  db.select().from(wishes).where(eq(wishes.id, wishId)).get()?.deletedAt

describe('putting a wish on a list and taking it off', () => {
  it('takes a joint wish off one list and leaves it with the other list\'s owners', () => {
    const { db, art, lot, A, aId, lId } = setup()
    const game = addWishTo(db, art.id, A, 'Bordspel')
    putOnList(db, lId, game.id)
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
    expect([standing(db, game.id, art.id), standing(db, game.id, lot.id)]).toEqual([0, 1])

    expect(takeOffList(db, aId, game.id)).toEqual([art.id])
    expect(ownerIds(db, game.id)).toEqual([lot.id])
    expect(deletedAt(db, game.id)).toBeNull()
    expect(takeOffList(db, lId, game.id)).toEqual([lot.id])
    expect(deletedAt(db, game.id)).toBeInstanceOf(Date)
    expectOwnersSettled(db)
  })

  it('gives a new wish to every owner of its list', () => {
    const { db, art, sam, A } = setup()
    addOwner(db, A, sam.id)
    const book = addWishTo(db, art.id, A, 'Boek')
    expect(ownerIds(db, book.id)).toEqual([art.id, sam.id])
    expect([standing(db, book.id, art.id), standing(db, book.id, sam.id)]).toEqual([0, 0])
    expectOwnersSettled(db)
  })

  it('keeps someone as owner who has the wish on another list of theirs', () => {
    const { db, art, A, aId } = setup()
    const birthday = addList(db, art.id, 'Verjaardag')
    const book = addWishTo(db, art.id, A, 'Boek')
    putOnList(db, ownedListId(db, art.id, birthday), book.id)

    expect(takeOffList(db, aId, book.id)).toEqual([])
    expect(ownerIds(db, book.id)).toEqual([art.id])
    expect(standing(db, book.id, art.id)).toBe(1)
    expect(deletedAt(db, book.id)).toBeNull()
    expectOwnersSettled(db)
  })

  it('takes a wish off a joint list for all its owners', () => {
    const { db, art, sam, A, aId } = setup()
    addOwner(db, A, sam.id)
    const book = addWishTo(db, art.id, A, 'Boek')

    expect(takeOffList(db, aId, book.id)).toEqual([art.id, sam.id])
    expect(ownerIds(db, book.id)).toEqual([])
    expect(standing(db, book.id, art.id)).toBeNull()
    expect(deletedAt(db, book.id)).toBeInstanceOf(Date)
    expectOwnersSettled(db)
  })

  it('brings a taken-off placement back with a later join order, without a second row', () => {
    const { db, art, lot, A, L, lId } = setup()
    const game = addWishTo(db, art.id, A, 'Bordspel')
    putOnList(db, lId, game.id)
    takeOffList(db, lId, game.id)
    // Still found through the list it left, so a buyer there can take back what they bought.
    expect(wishOnList(db, L, game.id)).toMatchObject({ live: false, placement: { joinOrder: 1 } })
    expect(wishOnList(db, L, game.id).placement.removedAt).toBeInstanceOf(Date)

    putOnList(db, lId, game.id)
    const rows = db.select().from(listWishes).where(and(eq(listWishes.listId, lId), eq(listWishes.wishId, game.id))).all()
    expect(rows).toMatchObject([{ joinOrder: 2, removedAt: null }])
    expect(wishOnList(db, L, game.id).live).toBe(true)
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
    expect(standing(db, game.id, lot.id)).toBe(2)
    expectOwnersSettled(db)
  })

  it('refuses to put a 201st live wish on a list', () => {
    const { db, art, A, aId } = setup()
    const first = addWishTo(db, art.id, A, 'Eerste')
    for (let i = 1; i < 199; i++) addWishTo(db, art.id, A, `Wens ${i}`)
    expect(codeOf(() => assertRoom(db, aId))).toBeUndefined()
    expect(codeOf(() => assertRoom(db, aId, 2))).toBe('wish_limit')

    addWishTo(db, art.id, A, 'Laatste')
    expect(codeOf(() => assertRoom(db, aId))).toBe('wish_limit')
    // A wish taken off no longer counts as live.
    takeOffList(db, aId, first.id)
    expect(codeOf(() => assertRoom(db, aId))).toBeUndefined()
    expectOwnersSettled(db)
  })

  it('never touches purchases or notes', () => {
    expect(readFileSync('server/domain/placement.ts', 'utf8')).not.toMatch(/purchases|notes/i)
  })
})
