import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { listWishes, wishOwners, wishes } from '../server/db/schema'
import { ownedListId } from '../server/domain/lists'
import { livePublicWishes } from '../server/domain/public-wishes'
import { addWish, deleteWish, setWishImage, updateWish } from '../server/domain/wishes'
import { wishInput, wishPatchInput } from '../shared/schemas/input'
import { publicWishSchema } from '../shared/schemas/list'
import { addList, addUser, addWishTo, codeOf, makeDb } from './helpers'

function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const mom = addUser(db, 'mom')
  const token = addList(db, art.id)
  return { db, art, mom, token, listId: ownedListId(db, art.id, token) }
}

const input = (title: string, extra: object = {}) => wishInput.parse({ title, ...extra })

describe('wishes', () => {
  it('adds a wish from a title alone', () => {
    const { db, art, token } = setup()
    const wish = addWish(db, art.id, token, input('Boek'))
    expect(wish).toMatchObject({ title: 'Boek', quantity: 1, description: null, url: null, image: null })
    expect(() => publicWishSchema.parse(wish)).not.toThrow()
  })

  it('makes the owner of the list the owner of the wish', () => {
    const { db, art, token } = setup()
    const wish = addWish(db, art.id, token, input('Boek'))
    expect(db.select().from(wishOwners).where(eq(wishOwners.wishId, wish.id)).all()).toMatchObject([{ userId: art.id }])
  })

  it('changes a wish', () => {
    const { db, art, token } = setup()
    const { id } = addWish(db, art.id, token, input('Boek'))
    const changed = updateWish(db, art.id, token, id, input('Dik boek', { description: 'Hardcover', quantity: null }))
    expect(changed).toMatchObject({ id, title: 'Dik boek', description: 'Hardcover', quantity: null })
  })

  describe('a change that names only some fields', () => {
    function withEverything() {
      const { db, art, token } = setup()
      const { id } = addWish(db, art.id, token, input('Boek', { description: 'Hardcover', url: 'https://example.test/boek', quantity: 3 }))
      return { db, art, token, id }
    }

    it('keeps the amount, text and link when only the title changes', () => {
      const { db, art, token, id } = withEverything()
      const changed = updateWish(db, art.id, token, id, wishPatchInput.parse({ title: 'Dik boek' }))
      expect(changed).toMatchObject({ title: 'Dik boek', description: 'Hardcover', url: 'https://example.test/boek', quantity: 3 })
    })

    it('takes the limit off and keeps the rest when only the amount is null', () => {
      const { db, art, token, id } = withEverything()
      const changed = updateWish(db, art.id, token, id, wishPatchInput.parse({ quantity: null }))
      expect(changed).toMatchObject({ title: 'Boek', description: 'Hardcover', url: 'https://example.test/boek', quantity: null })
    })
  })

  it('gives someone else not_found for update, delete and image', () => {
    const { db, mom, art, token } = setup()
    const { id } = addWish(db, art.id, token, input('Boek'))
    expect(codeOf(() => updateWish(db, mom.id, token, id, input('Mijn')))).toBe('not_found')
    expect(codeOf(() => deleteWish(db, mom.id, token, id))).toBe('not_found')
    expect(codeOf(() => setWishImage(db, mom.id, token, id, 'a.png'))).toBe('not_found')
    expect(codeOf(() => addWish(db, mom.id, token, input('Mijn')))).toBe('not_found')
  })

  it('does not reach a wish through another list, even one the same person owns', () => {
    const { db, art, token } = setup()
    const other = addList(db, art.id, 'Verjaardag')
    const { id } = addWish(db, art.id, token, input('Boek'))
    expect(codeOf(() => updateWish(db, art.id, other, id, input('X')))).toBe('not_found')
    expect(codeOf(() => deleteWish(db, art.id, other, id))).toBe('not_found')
    expect(codeOf(() => setWishImage(db, art.id, other, id, null))).toBe('not_found')
  })

  it('deletes a wish once', () => {
    const { db, art, token, listId } = setup()
    const keep = addWishTo(db, art.id, token, 'Lamp')
    const { id } = addWishTo(db, art.id, token, 'Boek')
    deleteWish(db, art.id, token, id)
    expect(livePublicWishes(db, listId).map(w => w.id)).toEqual([keep.id])
    expect(codeOf(() => deleteWish(db, art.id, token, id))).toBe('not_found')
    expect(codeOf(() => updateWish(db, art.id, token, id, input('X')))).toBe('not_found')
    // The row stays.
    expect(db.select().from(wishes).where(eq(wishes.id, id)).get()?.deletedAt).toBeInstanceOf(Date)
  })

  it('lists live wishes oldest first', () => {
    const { db, art, token, listId } = setup()
    const a = addWishTo(db, art.id, token, 'A')
    const b = addWishTo(db, art.id, token, 'B')
    expect(livePublicWishes(db, listId).map(w => w.id)).toEqual([a.id, b.id])
  })

  it('sets, replaces and clears an image, reporting the previous one', () => {
    const { db, art, token, listId } = setup()
    const { id } = addWishTo(db, art.id, token, 'Boek')
    expect(setWishImage(db, art.id, token, id, 'a.png')).toEqual({ previous: null })
    expect(livePublicWishes(db, listId)[0]!.image).toBe('/uploads/a.png')
    expect(setWishImage(db, art.id, token, id, 'b.png')).toEqual({ previous: 'a.png' })
    expect(setWishImage(db, art.id, token, id, null)).toEqual({ previous: 'b.png' })
    expect(livePublicWishes(db, listId)[0]!.image).toBeNull()
  })

  it('refuses the 201st live wish, and counts only live ones', () => {
    const { db, art, token } = setup()
    const first = addWishTo(db, art.id, token, 'Eerste')
    for (let i = 1; i < 200; i++) addWishTo(db, art.id, token, `Wens ${i}`)
    expect(codeOf(() => addWishTo(db, art.id, token, 'Te veel'))).toBe('wish_limit')
    deleteWish(db, art.id, token, first.id)
    expect(codeOf(() => addWishTo(db, art.id, token, 'Past weer'))).toBeUndefined()
  })

  it('refuses a wish once the list has had 500, deleted or not', () => {
    const { db, art, token, listId } = setup()
    for (let i = 0; i < 500; i++) {
      const id = db.insert(wishes).values({ title: `Weg ${i}`, deletedAt: new Date() }).returning().get().id
      db.insert(listWishes).values({ listId, wishId: id }).run()
    }
    // Not wish_limit: deleting a wish wouldn't help here.
    expect(codeOf(() => addWishTo(db, art.id, token, 'Nog een'))).toBe('wish_limit_ever')
  })

  it.each(['server/domain/public-wishes.ts', 'server/domain/wishes.ts', 'server/domain/lists.ts'])('%s never touches purchases or notes', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/purchases|notes/i)
  })
})
