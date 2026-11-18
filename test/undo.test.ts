import { readFileSync } from 'node:fs'
import { count, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { linkChanges, listWishes, wishes, wishLinks } from '../server/db/schema'
import { getListView } from '../server/domain/list-view'
import { ownedListId } from '../server/domain/lists'
import { listNotices } from '../server/domain/notices'
import { copyWish, linkWish } from '../server/domain/sharing'
import { dismissNotice, undoLink, unusedImages } from '../server/domain/undo'
import { deleteWish, setWishCover, setWishImage, updateWish } from '../server/domain/wishes'
import { wishPatchInput } from '../shared/schemas/input'
import { addList, addOwner, addUser, addWishTo, codeOf, expectOwnersSettled, makeDb, ownerIds, wishIn } from './helpers'

function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lot = addUser(db, 'lot')
  const mom = addUser(db, 'mom')
  const A = addList(db, art.id)
  const game = addWishTo(db, art.id, A, 'Bordspel')
  setWishImage(db, art.id, A, game.id, 'old.png')
  const L = addList(db, lot.id, 'Lijst van Lotte')
  return { db, art, lot, mom, A, game, L }
}

const change = (fields: object) => wishPatchInput.parse(fields)
const wishRow = (db: ReturnType<typeof makeDb>, id: number) => db.select().from(wishes).where(eq(wishes.id, id)).get()!
const rememberedRows = (db: ReturnType<typeof makeDb>) => db.select({ n: count() }).from(linkChanges).get()!.n

describe('undoing a link', () => {
  it('puts the wish back as it was and leaves the linker a copy', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    updateWish(db, lot.id, L, game.id, change({ title: 'Ander spel', quantity: 2 }))
    expect(setWishImage(db, lot.id, L, game.id, 'new.png')).toMatchObject({ unused: [] }) // old.png is kept for the undo
    expect(undoLink(db, art.id, A, game.id, lot.id)).toMatchObject({ unused: ['new.png'] })

    expect(wishIn(getListView(db, A, art.id), game.id)).toMatchObject({ title: 'Bordspel', quantity: 1, image: '/uploads/old.png' })
    expect(ownerIds(db, game.id)).toEqual([art.id])
    const hers = getListView(db, L, lot.id)!.wishes
    expect(hers).toMatchObject([{ title: 'Bordspel', role: 'owner', mine: 0, image: '/uploads/old.png' }])
    expect(hers[0]!.id).not.toBe(game.id)
    expect(listNotices(db, art.id)).toEqual([])
    expect(listNotices(db, lot.id)).toMatchObject([{ kind: 'wish_unlinked', actor: 'Art', title: 'Bordspel', token: L, wishId: hers[0]!.id }])
    expect(db.select().from(wishLinks).all()).toEqual([])
    expect(rememberedRows(db)).toBe(0)
    expectOwnersSettled(db)
  })

  it('keeps what an earlier owner changed after the linker did', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    updateWish(db, lot.id, L, game.id, change({ title: 'Ander spel', description: 'Voor vier spelers' }))
    updateWish(db, art.id, A, game.id, change({ title: 'Kaartspel' }))
    undoLink(db, art.id, A, game.id, lot.id)
    expect(wishIn(getListView(db, A, art.id), game.id)).toMatchObject({ title: 'Kaartspel', description: null })
  })

  it('goes back to the value before the linker first changed it', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    updateWish(db, lot.id, L, game.id, change({ title: 'Ander spel' }))
    updateWish(db, lot.id, A, game.id, change({ title: 'Nog een ander spel' }))
    undoLink(db, art.id, A, game.id, lot.id)
    expect(wishIn(getListView(db, A, art.id), game.id)).toMatchObject({ title: 'Bordspel' })
  })

  it('remembers only the fields whose value changed', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    updateWish(db, lot.id, L, game.id, change({ title: 'Bordspel', quantity: 3 }))
    expect(db.select({ field: linkChanges.field, before: linkChanges.before }).from(linkChanges).all()).toEqual([{ field: 'quantity', before: '1' }])
    undoLink(db, art.id, A, game.id, lot.id)
    expect(wishIn(getListView(db, A, art.id), game.id)).toMatchObject({ title: 'Bordspel', quantity: 1 })
  })

  it('puts back an empty field and an unlimited amount', () => {
    const { db, art, lot, A, L } = setup()
    const puzzles = addWishTo(db, art.id, A, 'Puzzels', null)
    linkWish(db, lot.id, A, puzzles.id, { list: L })
    updateWish(db, lot.id, L, puzzles.id, change({ quantity: 2, urls: ['https://example.test/puzzel'] }))
    setWishImage(db, lot.id, L, puzzles.id, 'puzzel.png')
    expect(undoLink(db, art.id, A, puzzles.id, lot.id)).toMatchObject({ unused: ['puzzel.png'] })
    expect(wishIn(getListView(db, A, art.id), puzzles.id)).toMatchObject({ quantity: null, urls: [], image: null })
  })

  it('puts the links back as the list they were, in their order', () => {
    const { db, art, lot, A, game, L } = setup()
    const shop = 'https://example.test/spel'
    const other = 'https://example.org/spel'
    updateWish(db, art.id, A, game.id, change({ urls: [shop, other] }))
    linkWish(db, lot.id, A, game.id, { list: L })
    updateWish(db, lot.id, L, game.id, change({ urls: [other] }))
    updateWish(db, lot.id, L, game.id, change({ urls: [] }))
    expect(db.select({ field: linkChanges.field, before: linkChanges.before }).from(linkChanges).all())
      .toEqual([{ field: 'urls', before: JSON.stringify([shop, other]) }])
    undoLink(db, art.id, A, game.id, lot.id)
    expect(wishIn(getListView(db, A, art.id), game.id)).toMatchObject({ urls: [shop, other] })
  })

  it('remembers nothing for the same links sent again, and nothing for no links on a wish that had none', () => {
    const { db, art, lot, A, game, L } = setup()
    const shop = 'https://example.test/spel'
    linkWish(db, lot.id, A, game.id, { list: L })
    // The wish was made without links, so its column may hold nothing at all.
    db.update(wishes).set({ urls: null }).where(eq(wishes.id, game.id)).run()
    updateWish(db, lot.id, L, game.id, change({ urls: [] }))
    expect(rememberedRows(db)).toBe(0)
    updateWish(db, art.id, A, game.id, change({ urls: [shop] }))
    updateWish(db, lot.id, L, game.id, change({ urls: [shop] }))
    expect(rememberedRows(db)).toBe(0)
  })

  it('takes back a link the linker put on, together with its cover', () => {
    const { db, art, lot, A, L } = setup()
    const lamp = addWishTo(db, art.id, A, 'Lamp')
    linkWish(db, lot.id, A, lamp.id, { list: L })
    const shop = 'https://example.test/lamp'
    updateWish(db, lot.id, L, lamp.id, change({ urls: [shop] }))
    setWishCover(db, lot.id, L, lamp.id, shop, 'cover.jpg')
    expect(wishIn(getListView(db, A, art.id), lamp.id)).toMatchObject({ image: '/uploads/cover.jpg', imageFromLink: true })
    expect(undoLink(db, art.id, A, lamp.id, lot.id)).toMatchObject({ unused: ['cover.jpg'] })
    expect(wishIn(getListView(db, A, art.id), lamp.id)).toMatchObject({ urls: [], image: null, imageFromLink: false })
  })

  it('puts a cover back as a cover, and a photo as a photo', () => {
    const { db, art, lot, A, game, L } = setup()
    const shop = 'https://example.test/spel'
    // Art's wish has a link with its cover; the linker puts up a photo of their own.
    const lamp = addWishTo(db, art.id, A, 'Lamp')
    updateWish(db, art.id, A, lamp.id, change({ urls: [shop] }))
    setWishCover(db, art.id, A, lamp.id, shop, 'cover.jpg')
    linkWish(db, lot.id, A, lamp.id, { list: L })
    expect(setWishImage(db, lot.id, L, lamp.id, 'photo.jpg')).toMatchObject({ unused: [] }) // the cover is kept for the undo
    expect(wishRow(db, lamp.id)).toMatchObject({ imageFile: 'photo.jpg', imageFromLink: false })
    expect(undoLink(db, art.id, A, lamp.id, lot.id)).toMatchObject({ unused: ['photo.jpg'] })
    expect(wishRow(db, lamp.id)).toMatchObject({ imageFile: 'cover.jpg', imageFromLink: true })

    // The other way round: the linker takes Art's photo off the game, and their link gives it a cover.
    linkWish(db, lot.id, A, game.id, { list: L })
    setWishImage(db, lot.id, L, game.id, null)
    updateWish(db, lot.id, L, game.id, change({ urls: [shop] }))
    setWishCover(db, lot.id, L, game.id, shop, 'spel.jpg')
    expect(wishRow(db, game.id)).toMatchObject({ imageFile: 'spel.jpg', imageFromLink: true })
    expect(undoLink(db, art.id, A, game.id, lot.id)).toMatchObject({ unused: ['spel.jpg'] })
    expect(wishRow(db, game.id)).toMatchObject({ imageFile: 'old.png', imageFromLink: false })
  })

  it('forgets where a picture came from together with the picture', () => {
    const { db, art, lot, A, L } = setup()
    const first = 'https://example.test/lamp'
    const second = 'https://example.org/lamp'
    const lamp = addWishTo(db, art.id, A, 'Lamp')
    setWishImage(db, art.id, A, lamp.id, 'photo.jpg')
    linkWish(db, lot.id, A, lamp.id, { list: L })
    // The linker swaps Art's photo for the cover of a link; Art then changes the link himself.
    setWishImage(db, lot.id, L, lamp.id, null)
    updateWish(db, lot.id, L, lamp.id, change({ urls: [first] }))
    setWishCover(db, lot.id, L, lamp.id, first, 'first.jpg')
    updateWish(db, art.id, A, lamp.id, change({ urls: [second] }))
    setWishCover(db, art.id, A, lamp.id, second, 'second.jpg')
    // Art's link and its cover are newer than anything the linker did, so undo keeps both.
    undoLink(db, art.id, A, lamp.id, lot.id)
    expect(wishRow(db, lamp.id)).toMatchObject({ urls: [second], imageFile: 'second.jpg', imageFromLink: true })
  })

  it('treats a picture remembered from before covers existed as a photo', () => {
    const { db, art, lot, A, game, L } = setup()
    const shop = 'https://example.test/spel'
    linkWish(db, lot.id, A, game.id, { list: L })
    setWishImage(db, lot.id, L, game.id, null)
    updateWish(db, lot.id, L, game.id, change({ urls: [shop] }))
    setWishCover(db, lot.id, L, game.id, shop, 'cover.jpg')
    // As an older version of the site left it: the picture's file, and not where it came from.
    db.delete(linkChanges).where(eq(linkChanges.field, 'imageFromLink')).run()
    undoLink(db, art.id, A, game.id, lot.id)
    expect(wishRow(db, game.id)).toMatchObject({ imageFile: 'old.png', imageFromLink: false })
  })

  it('stops remembering when the notice is dismissed', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    updateWish(db, lot.id, L, game.id, change({ title: 'Ander spel' }))
    expect(setWishImage(db, lot.id, L, game.id, 'new.png')).toMatchObject({ unused: [] })
    const [notice] = listNotices(db, art.id)
    expect(dismissNotice(db, art.id, notice!.id)).toMatchObject({ unused: ['old.png'] })

    expect(listNotices(db, art.id)).toEqual([])
    expect(db.select().from(wishLinks).all()).toEqual([])
    expect(rememberedRows(db)).toBe(0)
    expect(codeOf(() => undoLink(db, art.id, A, game.id, lot.id))).toBe('not_found')
    expect(wishIn(getListView(db, A, art.id), game.id)).toMatchObject({ title: 'Ander spel', image: '/uploads/new.png' })
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
  })

  it('keeps remembering until the last of two earlier owners dismissed', () => {
    const { db, art, lot, A, game, L } = setup()
    const sis = addUser(db, 'sis')
    addOwner(db, A, sis.id)
    linkWish(db, lot.id, A, game.id, { list: L })
    expect(setWishImage(db, lot.id, L, game.id, 'new.png')).toMatchObject({ unused: [] })

    expect(dismissNotice(db, art.id, listNotices(db, art.id)[0]!.id)).toMatchObject({ unused: [] })
    expect(listNotices(db, sis.id)).toMatchObject([{ kind: 'wish_linked', canUndo: true }])
    expect(dismissNotice(db, sis.id, listNotices(db, sis.id)[0]!.id)).toMatchObject({ unused: ['old.png'] })
    expect(db.select().from(wishLinks).all()).toEqual([])
  })

  it('lets the other earlier owner undo after one dismissed', () => {
    const { db, art, lot, A, game, L } = setup()
    const sis = addUser(db, 'sis')
    addOwner(db, A, sis.id)
    linkWish(db, lot.id, A, game.id, { list: L })
    updateWish(db, lot.id, L, game.id, change({ title: 'Ander spel' }))
    dismissNotice(db, art.id, listNotices(db, art.id)[0]!.id)
    expect(undoLink(db, sis.id, A, game.id, lot.id)).toMatchObject({ unused: [] })
    expect(wishIn(getListView(db, A, sis.id), game.id)).toMatchObject({ title: 'Bordspel' })
    expect(ownerIds(db, game.id)).toEqual([art.id, sis.id])
    expect(listNotices(db, sis.id)).toEqual([])
  })

  it('lets only someone who holds the notice undo, and only once', () => {
    const { db, art, lot, mom, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    // Joined A after the link was made, so she has no notice to undo.
    const sis = addUser(db, 'sis')
    addOwner(db, A, sis.id)
    for (const who of [lot, mom, sis]) {
      expect(codeOf(() => undoLink(db, who.id, A, game.id, lot.id))).toBe('not_found')
    }
    expect(codeOf(() => undoLink(db, lot.id, L, game.id, lot.id))).toBe('not_found')
    // Through a list that doesn't show the wish, or naming someone who didn't link it.
    expect(codeOf(() => undoLink(db, art.id, addList(db, art.id, 'Verjaardag'), game.id, lot.id))).toBe('not_found')
    expect(codeOf(() => undoLink(db, art.id, A, game.id, mom.id))).toBe('not_found')
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id, sis.id])

    expect(undoLink(db, art.id, A, game.id, lot.id)).toMatchObject({ unused: [] })
    expect(codeOf(() => undoLink(db, art.id, A, game.id, lot.id))).toBe('not_found')
    expect(listNotices(db, lot.id)).toHaveLength(1)
    expectOwnersSettled(db)
  })

  it('still puts the fields back when the linker already took the wish off their list', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    updateWish(db, lot.id, L, game.id, change({ title: 'Ander spel' }))
    deleteWish(db, lot.id, L, game.id)
    expect(undoLink(db, art.id, A, game.id, lot.id)).toMatchObject({ unused: [] })
    expect(wishIn(getListView(db, A, art.id), game.id)).toMatchObject({ title: 'Bordspel' })
    expect(getListView(db, L, lot.id)!.wishes).toEqual([])
    expect(listNotices(db, lot.id)).toEqual([])
    expect(listNotices(db, art.id)).toEqual([])
    expectOwnersSettled(db)
  })

  it('never fails on a list that has had 500 wishes', () => {
    const { db, art, lot, A, game, L } = setup()
    const lId = ownedListId(db, lot.id, L)
    for (let i = 0; i < 499; i++) {
      const id = db.insert(wishes).values({ title: `Weg ${i}`, deletedAt: new Date() }).returning().get().id
      db.insert(listWishes).values({ listId: lId, wishId: id, removedAt: new Date() }).run()
    }
    linkWish(db, lot.id, A, game.id, { list: L })
    expect(undoLink(db, art.id, A, game.id, lot.id)).toMatchObject({ unused: [] })
    expect(getListView(db, L, lot.id)!.wishes).toMatchObject([{ title: 'Bordspel', role: 'owner' }])
    expectOwnersSettled(db)
  })
})

describe('dismissing a notice', () => {
  it('only dismisses the caller\'s own notices', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    const [notice] = listNotices(db, art.id)
    expect(codeOf(() => dismissNotice(db, lot.id, notice!.id))).toBe('not_found')
    expect(codeOf(() => dismissNotice(db, art.id, 'no-such-notice'))).toBe('not_found')
    expect(listNotices(db, art.id)).toHaveLength(1)
    dismissNotice(db, art.id, notice!.id)
    expect(codeOf(() => dismissNotice(db, art.id, notice!.id))).toBe('not_found')
  })

  it('leaves the link alone when the notice was about something else', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    updateWish(db, lot.id, L, game.id, change({ title: 'Ander spel' }))
    const other = addList(db, art.id, 'Verjaardag')
    const lamp = addWishTo(db, art.id, other, 'Lamp')
    linkWish(db, lot.id, other, lamp.id, { list: L })
    const lampNotice = listNotices(db, art.id).find(notice => notice.wishId === lamp.id)!
    expect(dismissNotice(db, art.id, lampNotice.id)).toMatchObject({ unused: [] })
    expect(listNotices(db, art.id)).toMatchObject([{ wishId: game.id, canUndo: true }])
    undoLink(db, art.id, A, game.id, lot.id)
    expect(wishIn(getListView(db, A, art.id), game.id)).toMatchObject({ title: 'Bordspel' })
  })
})

describe('pictures', () => {
  it('reports a file unused only when no wish, deleted or not, and no link points at it', () => {
    const { db, art, lot, mom, A, game, L } = setup()
    const copied = copyWish(db, mom.id, A, game.id, { newList: 'Moederdag' })
    expect(unusedImages(db, ['old.png', 'gone.png', null, 'gone.png'])).toEqual(['gone.png'])
    deleteWish(db, art.id, A, game.id)
    deleteWish(db, mom.id, copied.token, copied.wishId)
    expect(unusedImages(db, ['old.png'])).toEqual([])

    const lamp = addWishTo(db, art.id, A, 'Lamp')
    setWishImage(db, art.id, A, lamp.id, 'lamp.png')
    linkWish(db, lot.id, A, lamp.id, { list: L })
    expect(setWishImage(db, lot.id, L, lamp.id, null)).toMatchObject({ unused: [] })
    expect(unusedImages(db, ['lamp.png'])).toEqual([])
  })

  it('forgets a picture the linker set once an earlier owner replaces it', () => {
    const { db, art, lot, A, game, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    expect(setWishImage(db, lot.id, L, game.id, 'new.png')).toMatchObject({ unused: [] })
    // Art's own picture wins; the one from before the link is no longer needed for an undo.
    expect(setWishImage(db, art.id, A, game.id, 'art.png')).toMatchObject({ unused: ['new.png', 'old.png'] })
    expect(undoLink(db, art.id, A, game.id, lot.id)).toMatchObject({ unused: [] })
    expect(wishIn(getListView(db, A, art.id), game.id)).toMatchObject({ image: '/uploads/art.png' })
  })
})

it('server/domain/undo.ts never touches purchases or notes', () => {
  expect(readFileSync('server/domain/undo.ts', 'utf8')).not.toMatch(/purchases|notes/i)
})
