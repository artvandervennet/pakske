import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { listWishes, wishOwners, wishes } from '../server/db/schema'
import { ownedListId } from '../server/domain/lists'
import { putOnList } from '../server/domain/placement'
import { copyWish, linkWish, unlinkOwner } from '../server/domain/sharing'
import { livePublicWishes } from '../server/domain/public-wishes'
import { addWish, addWishes, deleteWish, deleteWishes, ownedWishOnList, setWishCover, setWishImage, updateWish } from '../server/domain/wishes'
import { wishInput, wishPatchInput } from '../shared/schemas/input'
import { publicWishSchema } from '../shared/schemas/list'
import { addList, addUser, addWishTo, codeOf, expectOwnersSettled, makeDb, ownerIds } from './helpers'

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
    expect(wish).toMatchObject({ title: 'Boek', quantity: 1, description: null, urls: [], image: null, imageFromLink: false })
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
    const changed = updateWish(db, art.id, token, id, input('Dik boek', { description: 'Hardcover', quantity: null })).wish
    expect(changed).toMatchObject({ id, title: 'Dik boek', description: 'Hardcover', quantity: null })
  })

  describe('a change that names only some fields', () => {
    function withEverything() {
      const { db, art, token } = setup()
      const { id } = addWish(db, art.id, token, input('Boek', { description: 'Hardcover', urls: ['https://example.test/boek', 'https://example.org/boek'], quantity: 3 }))
      return { db, art, token, id }
    }

    it('keeps the amount, text and link when only the title changes', () => {
      const { db, art, token, id } = withEverything()
      const changed = updateWish(db, art.id, token, id, wishPatchInput.parse({ title: 'Dik boek' })).wish
      expect(changed).toMatchObject({ title: 'Dik boek', description: 'Hardcover', urls: ['https://example.test/boek', 'https://example.org/boek'], quantity: 3 })
    })

    it('takes the limit off and keeps the rest when only the amount is null', () => {
      const { db, art, token, id } = withEverything()
      const changed = updateWish(db, art.id, token, id, wishPatchInput.parse({ quantity: null })).wish
      expect(changed).toMatchObject({ title: 'Boek', description: 'Hardcover', urls: ['https://example.test/boek', 'https://example.org/boek'], quantity: null })
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
    expect(ownerIds(db, id)).toEqual([])
    expectOwnersSettled(db)
  })

  it('lists live wishes oldest first', () => {
    const { db, art, token, listId } = setup()
    const a = addWishTo(db, art.id, token, 'A')
    const b = addWishTo(db, art.id, token, 'B')
    expect(livePublicWishes(db, listId).map(w => w.id)).toEqual([a.id, b.id])
  })

  it('sets, replaces and clears an image, reporting the file nothing uses any more', () => {
    const { db, art, token, listId } = setup()
    const { id } = addWishTo(db, art.id, token, 'Boek')
    expect(setWishImage(db, art.id, token, id, 'a.png')).toMatchObject({ unused: [] })
    expect(livePublicWishes(db, listId)[0]!.image).toBe('/uploads/a.png')
    expect(setWishImage(db, art.id, token, id, 'b.png')).toMatchObject({ unused: ['a.png'] })
    expect(setWishImage(db, art.id, token, id, null)).toMatchObject({ unused: ['b.png'] })
    expect(livePublicWishes(db, listId)[0]!.image).toBeNull()
  })

  it('keeps a picture a copy shares until neither wish uses it', () => {
    const { db, art, mom, token } = setup()
    const { id } = addWishTo(db, art.id, token, 'Boek')
    setWishImage(db, art.id, token, id, 'a.png')
    const copy = copyWish(db, mom.id, token, id, { newList: 'Moederdag' })
    expect(setWishImage(db, art.id, token, id, 'b.png')).toMatchObject({ unused: [] })
    expect(setWishImage(db, mom.id, copy.token, copy.wishId, null)).toMatchObject({ unused: ['a.png'] })

    // The other way round, and a deleted wish still holds on to its picture.
    setWishImage(db, mom.id, copy.token, copy.wishId, 'b.png')
    deleteWish(db, mom.id, copy.token, copy.wishId)
    expect(setWishImage(db, art.id, token, id, null)).toMatchObject({ unused: [] })
  })

  describe('the links of a wish', () => {
    const shop = 'https://example.test/boek'
    const other = 'https://example.org/boek'
    const patch = (fields: object) => wishPatchInput.parse(fields)

    it('keeps several links in the order they were given', () => {
      const { db, art, token, listId } = setup()
      const wish = addWish(db, art.id, token, input('Boek', { urls: [other, shop] }))
      expect(wish.urls).toEqual([other, shop])
      expect(livePublicWishes(db, listId)[0]!.urls).toEqual([other, shop])
    })

    it('replaces the whole list, and clears it with an empty one', () => {
      const { db, art, token } = setup()
      const { id } = addWish(db, art.id, token, input('Boek', { urls: [shop, other] }))
      expect(updateWish(db, art.id, token, id, patch({ urls: [other] })).wish.urls).toEqual([other])
      expect(updateWish(db, art.id, token, id, patch({ urls: [] })).wish.urls).toEqual([])
    })

    it('shows a wish from before several links, with nothing in the column, as having none', () => {
      const { db, art, token, listId } = setup()
      const { id } = addWishTo(db, art.id, token, 'Boek')
      db.update(wishes).set({ urls: null }).where(eq(wishes.id, id)).run()
      const [wish] = livePublicWishes(db, listId)
      expect(wish!.urls).toEqual([])
      expect(() => publicWishSchema.parse(wish)).not.toThrow()
    })

    it('carries the links, the picture and where the picture came from onto a copy', () => {
      const { db, art, mom, token } = setup()
      const { id } = addWish(db, art.id, token, input('Boek', { urls: [shop, other] }))
      setWishCover(db, art.id, token, id, shop, 'cover.jpg')
      const copy = copyWish(db, mom.id, token, id, { newList: 'Moederdag' })
      expect(db.select().from(wishes).where(eq(wishes.id, copy.wishId)).get())
        .toMatchObject({ urls: [shop, other], imageFile: 'cover.jpg', imageFromLink: true })
    })

    it('carries them onto the copy an unlink leaves', () => {
      const { db, art, mom, token } = setup()
      const { id } = addWish(db, art.id, token, input('Boek', { urls: [shop, other] }))
      setWishCover(db, art.id, token, id, shop, 'cover.jpg')
      const hers = linkWish(db, mom.id, token, id, { newList: 'Moederdag' })
      unlinkOwner(db, art.id, token, id, mom.id)
      const [left] = livePublicWishes(db, ownedListId(db, mom.id, hers.token))
      expect(left).toMatchObject({ urls: [shop, other], image: '/uploads/cover.jpg', imageFromLink: true })
      expect(left!.id).not.toBe(id)
    })
  })

  describe('the cover of the first link as the picture', () => {
    const shop = 'https://example.test/boek'
    const other = 'https://example.org/boek'
    const patch = (fields: object) => wishPatchInput.parse(fields)
    const row = (db: ReturnType<typeof makeDb>, id: number) => db.select().from(wishes).where(eq(wishes.id, id)).get()!

    function withCover() {
      const { db, art, mom, token } = setup()
      const { id } = addWish(db, art.id, token, input('Boek', { urls: [shop, other] }))
      setWishCover(db, art.id, token, id, shop, 'cover.jpg')
      return { db, art, mom, token, id }
    }

    it('asks for the cover of a new first link when the wish has no picture', () => {
      const { db, art, token } = setup()
      const { id } = addWishTo(db, art.id, token, 'Boek')
      expect(updateWish(db, art.id, token, id, patch({ urls: [shop] }))).toMatchObject({ coverOf: shop, unused: [] })
      // The same list again, another order behind the first, or a field that isn't the links: nothing to fetch.
      expect(updateWish(db, art.id, token, id, patch({ urls: [shop] })).coverOf).toBeNull()
      expect(updateWish(db, art.id, token, id, patch({ urls: [shop, other] })).coverOf).toBeNull()
      expect(updateWish(db, art.id, token, id, patch({ title: 'Dik boek' })).coverOf).toBeNull()
      expect(updateWish(db, art.id, token, id, patch({ urls: [other, shop] })).coverOf).toBe(other)
      expect(updateWish(db, art.id, token, id, patch({ urls: [] })).coverOf).toBeNull()
    })

    it('records a cover as the picture, marked as coming from the link', () => {
      const { db, art, token, listId } = setup()
      const { id } = addWish(db, art.id, token, input('Boek', { urls: [shop] }))
      const result = setWishCover(db, art.id, token, id, shop, 'cover.jpg')
      expect(result).toMatchObject({ unused: [], wish: { image: '/uploads/cover.jpg', imageFromLink: true } })
      expect(livePublicWishes(db, listId)[0]).toMatchObject({ image: '/uploads/cover.jpg', imageFromLink: true })
    })

    it('replaces the cover of an earlier first link, and frees its file', () => {
      const { db, art, token, id } = withCover()
      // The old cover goes with its link at once, so a failed fetch never leaves the wrong shop's picture.
      expect(updateWish(db, art.id, token, id, patch({ urls: [other, shop] }))).toMatchObject({
        coverOf: other, unused: ['cover.jpg'], wish: { image: null, imageFromLink: false },
      })
      expect(setWishCover(db, art.id, token, id, other, 'other.jpg')).toMatchObject({ unused: [] })
      expect(row(db, id)).toMatchObject({ imageFile: 'other.jpg', imageFromLink: true })
    })

    it('removes the cover when the first link goes', () => {
      const { db, art, token, id } = withCover()
      expect(updateWish(db, art.id, token, id, patch({ urls: [] }))).toMatchObject({ coverOf: null, unused: ['cover.jpg'] })
      expect(row(db, id)).toMatchObject({ imageFile: null, imageFromLink: false })
    })

    it('keeps the cover while the first link stays the first', () => {
      const { db, art, token, id } = withCover()
      expect(updateWish(db, art.id, token, id, patch({ urls: [shop] }))).toMatchObject({ coverOf: null, unused: [] })
      expect(updateWish(db, art.id, token, id, patch({ title: 'Dik boek' }))).toMatchObject({ coverOf: null, unused: [] })
      expect(row(db, id)).toMatchObject({ imageFile: 'cover.jpg', imageFromLink: true })
    })

    it('lets an uploaded photo win over the cover', () => {
      const { db, art, token, id } = withCover()
      expect(setWishImage(db, art.id, token, id, 'photo.jpg')).toEqual({ unused: ['cover.jpg'], coverOf: null })
      expect(row(db, id)).toMatchObject({ imageFile: 'photo.jpg', imageFromLink: false })
    })

    it('never touches an uploaded photo when the links change', () => {
      const { db, art, token } = setup()
      const { id } = addWish(db, art.id, token, input('Boek', { urls: [shop] }))
      setWishImage(db, art.id, token, id, 'photo.jpg')
      for (const urls of [[other, shop], [other], []]) {
        expect(updateWish(db, art.id, token, id, patch({ urls }))).toMatchObject({ coverOf: null, unused: [] })
        expect(row(db, id)).toMatchObject({ imageFile: 'photo.jpg', imageFromLink: false })
      }
    })

    it('drops a cover that arrives after the owner put up a photo of their own', () => {
      const { db, art, token } = setup()
      const { id } = addWish(db, art.id, token, input('Boek', { urls: [shop] }))
      setWishImage(db, art.id, token, id, 'photo.jpg')
      expect(setWishCover(db, art.id, token, id, shop, 'late.jpg')).toEqual({ wish: null, unused: ['late.jpg'] })
      expect(row(db, id)).toMatchObject({ imageFile: 'photo.jpg', imageFromLink: false })
    })

    it('drops a cover that arrives after the first link changed again', () => {
      const { db, art, token } = setup()
      const { id } = addWish(db, art.id, token, input('Boek', { urls: [shop] }))
      updateWish(db, art.id, token, id, patch({ urls: [other] }))
      expect(setWishCover(db, art.id, token, id, shop, 'late.jpg')).toEqual({ wish: null, unused: ['late.jpg'] })
      updateWish(db, art.id, token, id, patch({ urls: [] }))
      expect(setWishCover(db, art.id, token, id, other, 'later.jpg')).toEqual({ wish: null, unused: ['later.jpg'] })
      expect(row(db, id).imageFile).toBeNull()
    })

    it('asks for the cover again when an uploaded photo is removed, and not when a cover is', () => {
      const { db, art, token, id } = withCover()
      // Removing the cover itself is the owner saying no to it; it stays away until the first link changes.
      expect(setWishImage(db, art.id, token, id, null)).toEqual({ unused: ['cover.jpg'], coverOf: null })
      expect(updateWish(db, art.id, token, id, patch({ urls: [shop, other, 'https://example.net/boek'] })).coverOf).toBeNull()

      setWishImage(db, art.id, token, id, 'photo.jpg')
      expect(setWishImage(db, art.id, token, id, null)).toEqual({ unused: ['photo.jpg'], coverOf: shop })
      // Nothing to fetch for a wish that had no picture, or one without links.
      expect(setWishImage(db, art.id, token, id, null)).toEqual({ unused: [], coverOf: null })
      updateWish(db, art.id, token, id, patch({ urls: [] }))
      setWishImage(db, art.id, token, id, 'photo.jpg')
      expect(setWishImage(db, art.id, token, id, null)).toEqual({ unused: ['photo.jpg'], coverOf: null })
    })

    it('keeps a cover a copy shares until neither wish uses it', () => {
      const { db, art, mom, token, id } = withCover()
      const copy = copyWish(db, mom.id, token, id, { newList: 'Moederdag' })
      expect(updateWish(db, art.id, token, id, patch({ urls: [other] })).unused).toEqual([])
      expect(updateWish(db, mom.id, copy.token, copy.wishId, patch({ urls: [] })).unused).toEqual(['cover.jpg'])
    })

    it('gives someone else not_found for a cover, and through another list', () => {
      const { db, art, mom, token, id } = withCover()
      expect(codeOf(() => setWishCover(db, mom.id, token, id, shop, 'x.jpg'))).toBe('not_found')
      expect(codeOf(() => setWishCover(db, art.id, addList(db, art.id, 'Verjaardag'), id, shop, 'x.jpg'))).toBe('not_found')
    })
  })

  describe('several wishes at once, from an import', () => {
    const found = (n: number, from = 0) => Array.from({ length: n }, (_, at) => ({ title: `Wens ${from + at}`, url: `https://shop.example/p/${from + at}` }))

    it('puts them under what the list has, in their order, each with its one link', () => {
      const { db, art, token } = setup()
      addWishTo(db, art.id, token, 'Was er al')
      const added = addWishes(db, art.id, token, found(3))
      expect(added.map(wish => wish.title)).toEqual(['Wens 0', 'Wens 1', 'Wens 2'])
      expect(added[1]).toMatchObject({ urls: ['https://shop.example/p/1'], quantity: 1, description: null, image: null })
      expect(livePublicWishes(db, ownedListId(db, art.id, token)).map(wish => wish.title)).toEqual(['Was er al', 'Wens 0', 'Wens 1', 'Wens 2'])
      for (const wish of added) expect(ownerIds(db, wish.id)).toEqual([art.id])
      expectOwnersSettled(db)
    })

    it('adds all of them or none', () => {
      const { db, art, token, listId } = setup()
      addWishes(db, art.id, token, found(100))
      expect(codeOf(() => addWishes(db, art.id, token, found(101, 100)))).toBe('wish_limit')
      expect(livePublicWishes(db, listId)).toHaveLength(100)
      expect(db.select().from(wishes).all()).toHaveLength(100)
      expect(codeOf(() => addWishes(db, art.id, token, found(100, 100)))).toBeUndefined()
      expect(livePublicWishes(db, listId)).toHaveLength(200)
    })

    it('counts toward the 500 a list can ever have had', () => {
      const { db, art, token } = setup()
      for (let round = 0; round < 4; round++) deleteWishes(db, art.id, token, addWishes(db, art.id, token, found(100)).map(wish => wish.id), {})
      expect(codeOf(() => addWishes(db, art.id, token, found(101)))).toBe('wish_limit_ever')
      expect(codeOf(() => addWishes(db, art.id, token, found(100)))).toBeUndefined()
    })

    it('is for the list\'s owners only', () => {
      const { db, art, mom, token } = setup()
      expect(codeOf(() => addWishes(db, mom.id, token, found(2)))).toBe('not_found')
      expect(codeOf(() => addWishes(db, art.id, 'no-such-list', found(2)))).toBe('not_found')
      expect(db.select().from(wishes).all()).toEqual([])
    })
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

  describe('deleting several at once', () => {
    it('deletes them', () => {
      const { db, art, token, listId } = setup()
      const [a, , c] = ['A', 'B', 'C'].map(title => addWish(db, art.id, token, input(title)).id)
      deleteWishes(db, art.id, token, [a!, c!])
      expect(livePublicWishes(db, listId).map(wish => wish.title)).toEqual(['B'])
      for (const id of [a!, c!]) expect(db.select().from(wishes).where(eq(wishes.id, id)).get()?.deletedAt).not.toBeNull()
      expectOwnersSettled(db)
    })

    it('skips wishes that are already gone', () => {
      const { db, art, token, listId } = setup()
      const [a, b] = ['A', 'B'].map(title => addWish(db, art.id, token, input(title)).id)
      deleteWish(db, art.id, token, a!)
      expect(codeOf(() => deleteWishes(db, art.id, token, [a!, b!]))).toBeUndefined()
      expect(livePublicWishes(db, listId)).toEqual([])
    })

    it('refuses someone who doesn\'t own the list', () => {
      const { db, art, mom, token, listId } = setup()
      const { id } = addWish(db, art.id, token, input('A'))
      expect(codeOf(() => deleteWishes(db, mom.id, token, [id]))).toBe('not_found')
      expect(livePublicWishes(db, listId)).toHaveLength(1)
    })
  })

  describe('a joint wish, on Art\'s list and on Lotte\'s', () => {
    function joint() {
      const { db, art, mom, token } = setup()
      const lot = addUser(db, 'lotte')
      const theirs = addList(db, lot.id, 'Verjaardag')
      const wish = addWishTo(db, art.id, token, 'Bordspel')
      putOnList(db, ownedListId(db, lot.id, theirs), wish.id)
      return { db, art, lot, mom, token, theirs, wish }
    }

    it('lets Lotte change it and set its picture through Art\'s list', () => {
      const { db, art, lot, token, theirs, wish } = joint()
      expect(updateWish(db, lot.id, token, wish.id, wishPatchInput.parse({ title: 'Groot bordspel' })).wish).toMatchObject({ title: 'Groot bordspel' })
      expect(setWishImage(db, lot.id, token, wish.id, 'a.png')).toMatchObject({ unused: [] })
      for (const list of [token, theirs]) {
        expect(livePublicWishes(db, ownedListId(db, list === token ? art.id : lot.id, list))[0]).toMatchObject({ title: 'Groot bordspel', image: '/uploads/a.png' })
      }
    })

    it('does not let Lotte take it off Art\'s list', () => {
      const { db, art, lot, token, wish } = joint()
      expect(codeOf(() => deleteWish(db, lot.id, token, wish.id))).toBe('not_found')
      expect(ownerIds(db, wish.id)).toEqual([art.id, lot.id].sort((a, b) => a - b))
    })

    it('takes it off Art\'s list only when several are deleted at once', () => {
      const { db, art, lot, token, theirs, wish } = joint()
      const other = addWishTo(db, art.id, token, 'Sokken')
      deleteWishes(db, art.id, token, [wish.id, other.id])
      expect(db.select().from(wishes).where(eq(wishes.id, wish.id)).get()?.deletedAt).toBeNull()
      expect(ownerIds(db, wish.id)).toEqual([lot.id])
      expect(livePublicWishes(db, ownedListId(db, lot.id, theirs)).map(w => w.title)).toEqual(['Bordspel'])
      expect(livePublicWishes(db, ownedListId(db, art.id, token))).toEqual([])
      expectOwnersSettled(db)
    })

    it('takes it off Art\'s list only, so it stays Lotte\'s and is not deleted', () => {
      const { db, art, lot, token, theirs, wish } = joint()
      deleteWish(db, art.id, token, wish.id)
      expect(db.select().from(wishes).where(eq(wishes.id, wish.id)).get()?.deletedAt).toBeNull()
      expect(ownerIds(db, wish.id)).toEqual([lot.id])
      expect(livePublicWishes(db, ownedListId(db, art.id, token))).toEqual([])
      expect(livePublicWishes(db, ownedListId(db, lot.id, theirs)).map(w => w.id)).toEqual([wish.id])
      expectOwnersSettled(db)
    })

    it('no longer lets Art change it, through either list, once it is off his', () => {
      const { db, art, lot, token, theirs, wish } = joint()
      deleteWish(db, art.id, token, wish.id)
      for (const list of [token, theirs]) {
        expect(codeOf(() => updateWish(db, art.id, list, wish.id, input('X')))).toBe('not_found')
        expect(codeOf(() => setWishImage(db, art.id, list, wish.id, null))).toBe('not_found')
      }
      // Lotte still owns it, but not through the list it left.
      expect(codeOf(() => ownedWishOnList(db, lot.id, token, wish.id))).toBe('not_found')
      expect(ownedWishOnList(db, lot.id, theirs, wish.id).id).toBe(wish.id)
    })

    it('gives someone who owns neither the wish nor a list not_found', () => {
      const { db, mom, token, theirs, wish } = joint()
      for (const list of [token, theirs]) {
        expect(codeOf(() => ownedWishOnList(db, mom.id, list, wish.id))).toBe('not_found')
        expect(codeOf(() => updateWish(db, mom.id, list, wish.id, input('X')))).toBe('not_found')
      }
    })
  })

  it.each(['server/domain/public-wishes.ts', 'server/domain/wishes.ts', 'server/domain/lists.ts'])('%s never touches purchases or notes', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/purchases|notes/i)
  })
})
