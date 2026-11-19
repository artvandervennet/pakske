import { readFileSync } from 'node:fs'
import { eq, isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import { linkChanges, listOwners, lists, notes, users, wishes, wishLinks } from '../server/db/schema'
import { deleteAccount, logIn, logInWithGoogle, register, type Identity } from '../server/domain/accounts'
import { getListView } from '../server/domain/list-view'
import { listMyLists, listOwnedLists } from '../server/domain/lists'
import { addNote } from '../server/domain/notes'
import { listNotices } from '../server/domain/notices'
import { setPurchase } from '../server/domain/purchases'
import { copyWish, linkWish } from '../server/domain/sharing'
import { createUser, findUserById } from '../server/domain/users'
import { deleteWish, setWishImage, updateWish } from '../server/domain/wishes'
import { fakeIdentity, googleCredential } from './fake-identity'
import { addList, addOwner, addWishTo, codeOf, expectOwnersSettled, makeDb, ownerIds, purchaseRows, titles, wishIn } from './helpers'

const PASSWORD = 'correct horse'
const legacyCheck = async (hash: string, password: string) => hash === `hash:${password}`

async function rejection(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  }
  catch (error) {
    return (error as { code?: string }).code
  }
}

/** Art, Lotte and Mom, each with an account at Firebase and here, and the list every account starts with. */
async function setup() {
  const db = makeDb()
  const fake = fakeIdentity()
  const join = async (name: string) => {
    const { user, login } = await register(db, fake.identity, { email: `${name.toLowerCase()}@example.test`, displayName: name, password: PASSWORD })
    return { ...user, refreshToken: login.refreshToken, first: listMyLists(db, user.id).lists[0]!.token }
  }
  const art = await join('Art')
  const lot = await join('Lotte')
  const mom = await join('Mom')
  // `null` leaves the password out, as a request without one does.
  const remove = (who: { id: number, refreshToken: string }, password: string | null = PASSWORD) =>
    deleteAccount(db, fake.identity, findUserById(db, who.id)!, who.refreshToken, password ?? undefined, legacyCheck)
  return { db, ...fake, art, lot, mom, remove }
}

/** Live lists nobody owns: only a list whose one owner deleted their account. */
function ownerlessLists(db: Db): string[] {
  return db.select({ title: lists.title, owner: listOwners.userId }).from(lists)
    .leftJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(isNull(lists.deletedAt)).all()
    .filter(row => row.owner === null)
    .map(row => row.title)
}

describe('deleting an account', () => {
  it('removes it at Firebase and here, so nobody logs into it again', async () => {
    const { db, identity, accounts, art, remove } = await setup()
    await remove(art)
    expect(accounts.map(account => account.email)).toEqual(['lotte@example.test', 'mom@example.test'])
    expect(findUserById(db, art.id)).toBeUndefined()
    expect(await logIn(db, identity, 'art@example.test', PASSWORD, legacyCheck)).toBeNull()
    expect(db.select().from(users).all()).toHaveLength(2)
  })

  it('needs the current password, and deletes nothing without it', async () => {
    const { db, accounts, art, remove } = await setup()
    expect(await rejection(remove(art, 'wrong'))).toBe('wrong_password')
    expect(await rejection(remove(art, null))).toBe('wrong_password')
    expect(accounts).toHaveLength(3)
    expect(findUserById(db, art.id)).toBeDefined()
    expect(listOwnedLists(db, art.id)).toHaveLength(1)
  })

  it('takes along what the person was getting for others, and leaves what they wrote about it without a name', async () => {
    const { db, art, lot, mom, remove } = await setup()
    const book = addWishTo(db, mom.id, mom.first, 'Boek', 3)
    setPurchase(db, mom.first, book.id, art.id, 2)
    setPurchase(db, mom.first, book.id, lot.id, 1)
    addNote(db, mom.first, book.id, art.id, 'Ik haal ze in de stad.')
    addNote(db, mom.first, book.id, lot.id, 'Ik neem de derde.')
    await remove(art)
    expect(purchaseRows(db, book.id)).toEqual([{ userId: lot.id, quantity: 1 }])
    expect(db.select({ body: notes.body, userId: notes.userId }).from(notes).orderBy(notes.createdAt).all()).toEqual([
      { body: 'Ik haal ze in de stad.', userId: null },
      { body: 'Ik neem de derde.', userId: lot.id },
    ])
    // Mom's own page is as it was, and Lotte sees room for two again.
    expect(wishIn(getListView(db, mom.first, mom.id), book.id)).toMatchObject({ role: 'owner', mine: 0 })
    expect(wishIn(getListView(db, mom.first, lot.id), book.id)).toMatchObject({
      bought: 1,
      purchases: [{ name: 'Lotte', quantity: 1 }],
      notes: [
        { author: null, body: 'Ik haal ze in de stad.', mine: false },
        { author: 'Lotte', body: 'Ik neem de derde.', mine: true },
      ],
    })
  })

  it('leaves a list it shares to the other owners, with its wishes', async () => {
    const { db, art, lot, remove } = await setup()
    const samen = addList(db, art.id, 'Samen')
    addOwner(db, samen, lot.id)
    const mand = addWishTo(db, art.id, samen, 'Picknickmand')
    await remove(art)
    const view = getListView(db, samen, lot.id)!
    expect(view).toMatchObject({ deleted: false, owners: ['Lotte'], viewerOwnsList: true })
    expect(titles(view)).toEqual(['Picknickmand'])
    expect(ownerIds(db, mand.id)).toEqual([lot.id])
    expect(listOwnedLists(db, lot.id).map(list => list.title)).toEqual(['Samen', 'Verlanglijst'])
    expectOwnersSettled(db)
    // Only the list Art had alone is nobody's now.
    expect(ownerlessLists(db)).toEqual(['Verlanglijst'])
  })

  it('leaves a list it owns alone where it is, with its wishes and nobody\'s name', async () => {
    const { db, art, lot, mom, remove } = await setup()
    const sokken = addWishTo(db, art.id, art.first, 'Sokken')
    const trui = addWishTo(db, art.id, art.first, 'Trui')
    setPurchase(db, art.first, sokken.id, mom.id, 1)
    addNote(db, art.first, sokken.id, mom.id, 'Maat 43.')
    await remove(art)
    // Whoever has the link still opens it, logged in or not.
    const forVisitor = getListView(db, art.first, null)!
    expect(forVisitor).toMatchObject({ deleted: false, owners: [], viewerOwnsList: false })
    expect(titles(forVisitor)).toEqual(['Sokken', 'Trui'])
    // The buyers go on as before: what Mom is getting and what she wrote are still there.
    const forMom = getListView(db, art.first, mom.id)!
    expect(forMom).toMatchObject({ deleted: false, owners: [], viewerOwnsList: false })
    expect(forMom.wishes).toMatchObject([
      { id: sokken.id, role: 'buyer', removed: false, mine: 1, sharedWith: [], notes: [{ author: 'Mom', body: 'Maat 43.' }] },
      { id: trui.id, role: 'buyer', removed: false, mine: 0, bought: 0 },
    ])
    expect(wishIn(getListView(db, art.first, lot.id), sokken.id)).toMatchObject({ bought: 1, purchases: [{ name: 'Mom' }] })
    setPurchase(db, art.first, trui.id, lot.id, 1)
    // Nobody owns the wishes, and nobody can change them or the list.
    expect(ownerIds(db, sokken.id)).toEqual([])
    expect(codeOf(() => updateWish(db, lot.id, art.first, trui.id, { title: 'Broek' }))).toBe('not_found')
    expect(codeOf(() => deleteWish(db, lot.id, art.first, trui.id))).toBe('not_found')
    expect(listOwnedLists(db, lot.id).map(list => list.title)).toEqual(['Verlanglijst'])
    expectOwnersSettled(db)
    expect(ownerlessLists(db)).toEqual(['Verlanglijst'])
  })

  it('leaves a wish it shares with someone to that person, on both lists', async () => {
    const { db, art, lot, mom, remove } = await setup()
    const spel = addWishTo(db, art.id, art.first, 'Bordspel')
    const eigen = addWishTo(db, art.id, art.first, 'Alleen van Art')
    linkWish(db, lot.id, art.first, spel.id, { list: lot.first })
    expect(ownerIds(db, spel.id)).toEqual([art.id, lot.id])
    await remove(art)
    expect(ownerIds(db, spel.id)).toEqual([lot.id])
    expect(wishIn(getListView(db, lot.first, lot.id), spel.id)).toMatchObject({ role: 'owner', title: 'Bordspel', coOwners: [] })
    // On the list Art left behind it is Lotte's wish, and the one only he had is nobody's.
    expect(getListView(db, art.first, mom.id)!.wishes).toMatchObject([
      { id: spel.id, role: 'buyer', sharedWith: ['Lotte'] },
      { id: eigen.id, role: 'buyer', sharedWith: [] },
    ])
    expect(ownerIds(db, eigen.id)).toEqual([])
    expectOwnersSettled(db)

    // Lotte takes it off her own list: it stays on the list that still shows it.
    deleteWish(db, lot.id, lot.first, spel.id)
    expect(db.select().from(wishes).where(eq(wishes.id, spel.id)).get()!.deletedAt).toBeNull()
    expect(titles(getListView(db, art.first, null))).toEqual(['Bordspel', 'Alleen van Art'])
    expect(ownerIds(db, spel.id)).toEqual([])
    expectOwnersSettled(db)
  })

  it('lets a wish nobody owns be copied, not linked: nobody is there to undo a link', async () => {
    const { db, art, lot, remove } = await setup()
    const sokken = addWishTo(db, art.id, art.first, 'Sokken')
    await remove(art)
    expect(codeOf(() => linkWish(db, lot.id, art.first, sokken.id, { list: lot.first }))).toBe('forbidden')
    expect(ownerIds(db, sokken.id)).toEqual([])
    const copy = copyWish(db, lot.id, art.first, sokken.id, { list: lot.first })
    expect(copy.wishId).not.toBe(sokken.id)
    expect(titles(getListView(db, lot.first, lot.id))).toEqual(['Sokken'])
    expect(titles(getListView(db, art.first, null))).toEqual(['Sokken'])
    expectOwnersSettled(db)
  })

  it('gives an account made again with the same address nothing of the old one', async () => {
    const { db, identity, art, mom, remove } = await setup()
    const sokken = addWishTo(db, art.id, art.first, 'Sokken')
    const book = addWishTo(db, mom.id, mom.first, 'Boek')
    setPurchase(db, mom.first, book.id, art.id, 1)
    addNote(db, mom.first, book.id, art.id, 'Ik haal het in de stad.')
    await remove(art)

    const again = await register(db, identity, { email: 'art@example.test', displayName: 'Art', password: PASSWORD })
    expect(again.user.id).not.toBe(art.id)
    // Its own first list, and none of the old ones.
    const mine = listOwnedLists(db, again.user.id)
    expect(mine).toMatchObject([{ title: 'Verlanglijst', wishes: 0 }])
    expect(mine[0]!.token).not.toBe(art.first)
    // The old list is nobody's, also to him: he opens it as a buyer would.
    const old = getListView(db, art.first, again.user.id)!
    expect(old).toMatchObject({ owners: [], viewerOwnsList: false })
    expect(wishIn(old, sokken.id)).toMatchObject({ role: 'buyer' })
    expect(ownerIds(db, sokken.id)).toEqual([])
    // The note he wrote before is nobody's, and what he ticked is not back.
    expect(wishIn(getListView(db, mom.first, again.user.id), book.id)).toMatchObject({
      mine: 0,
      bought: 0,
      notes: [{ author: null, mine: false }],
    })
    expect(listNotices(db, again.user.id)).toEqual([])
  })

  it('hands back the pictures nothing points at any more', async () => {
    // Lotte links Art's wish and gives it another picture; her link keeps Art's for an undo.
    const linked = async () => {
      const world = await setup()
      const { db, art, lot } = world
      const spel = addWishTo(db, art.id, art.first, 'Bordspel')
      setWishImage(db, art.id, art.first, spel.id, 'old.png')
      linkWish(db, lot.id, art.first, spel.id, { list: lot.first })
      expect(setWishImage(db, lot.id, lot.first, spel.id, 'new.png')).toEqual({ unused: [], coverOf: null })
      return { ...world, spel }
    }
    const left = (db: Db) => ({ links: db.select().from(wishLinks).all().length, remembered: db.select().from(linkChanges).all().length })

    // The linker goes: nobody can undo her link any more, so the picture it kept is free.
    const hers = await linked()
    expect(await hers.remove(hers.lot)).toEqual({ unused: ['old.png'] })
    expect(wishIn(getListView(hers.db, hers.art.first, hers.art.id), hers.spel.id)).toMatchObject({ image: '/uploads/new.png', coOwners: [] })
    expect(listNotices(hers.db, hers.art.id)).toEqual([])
    expect(left(hers.db)).toEqual({ links: 0, remembered: 0 })

    // The earlier owner goes: his was the only notice that could undo it, so the same holds.
    const his = await linked()
    expect(await his.remove(his.art)).toEqual({ unused: ['old.png'] })
    expect(wishIn(getListView(his.db, his.lot.first, his.lot.id), his.spel.id)).toMatchObject({ image: '/uploads/new.png' })
    expect(left(his.db)).toEqual({ links: 0, remembered: 0 })
  })

  it('keeps the picture of a wish that stays, also a deleted one someone was getting', async () => {
    const { db, art, mom, remove } = await setup()
    const sokken = addWishTo(db, art.id, art.first, 'Sokken')
    setWishImage(db, art.id, art.first, sokken.id, 'socks.png')
    setPurchase(db, art.first, sokken.id, mom.id, 1)
    expect(await remove(art)).toEqual({ unused: [] })
    expect(wishIn(getListView(db, art.first, mom.id), sokken.id)).toMatchObject({ image: '/uploads/socks.png' })
  })

  it('goes by the login itself for an account that only logs in with Google', async () => {
    const db = makeDb()
    const { identity, accounts, tooOld, refusing } = fakeIdentity()
    const lotte = await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    const remove = (refreshToken?: string) => deleteAccount(db, identity, findUserById(db, lotte.user.id)!, refreshToken, undefined, legacyCheck)
    expect(await rejection(remove(undefined))).toBe('reauth_needed')
    // A login from long ago could be anyone at an open browser: nothing goes, here or there,
    // whether Firebase would mind or not.
    tooOld.add(lotte.login.uid)
    expect(await rejection(remove(lotte.login.refreshToken))).toBe('reauth_needed')
    expect(accounts).toHaveLength(1)
    expect(findUserById(db, lotte.user.id)).toBeDefined()
    tooOld.clear()
    // A fresh login that Firebase still refuses.
    refusing.add(lotte.login.uid)
    expect(await rejection(remove(lotte.login.refreshToken))).toBe('reauth_needed')
    expect(findUserById(db, lotte.user.id)).toBeDefined()
    refusing.clear()
    await remove(lotte.login.refreshToken)
    expect(accounts).toEqual([])
    expect(findUserById(db, lotte.user.id)).toBeUndefined()
  })

  // The server stopped between the two halves, or a backup from before the deletion was put back.
  it('finishes a deletion whose Firebase half already happened, on the word of the login cookie', async () => {
    const { db, accounts, art, lot, remove } = await setup()
    accounts.splice(accounts.findIndex(account => account.email === 'art@example.test'), 1)
    // No password can check out any more, and none is needed: the account at Firebase is gone.
    await remove(art, null)
    expect(findUserById(db, art.id)).toBeUndefined()
    expect(getListView(db, art.first, null)).toMatchObject({ owners: [] })
    // Someone else's cookie finishes nothing of Art's, and their own account still needs its password.
    expect(await rejection(remove(lot, null))).toBe('wrong_password')
    expect(findUserById(db, lot.id)).toBeDefined()
  })

  it('checks the password of an account from before Firebase here, and never asks Firebase', async () => {
    const db = makeDb()
    const silent = new Proxy({}, { get: (_, method) => () => { throw new Error(`Firebase was asked: ${String(method)}`) } }) as Identity
    const old = createUser(db, { email: 'art@example.test', displayName: 'Art', passwordHash: 'hash:correct horse' })
    expect(await rejection(deleteAccount(db, silent, old, undefined, 'wrong', legacyCheck))).toBe('wrong_password')
    expect(await rejection(deleteAccount(db, silent, old, undefined, undefined, legacyCheck))).toBe('wrong_password')
    expect(findUserById(db, old.id)).toBeDefined()
    await deleteAccount(db, silent, old, undefined, PASSWORD, legacyCheck)
    expect(findUserById(db, old.id)).toBeUndefined()
    expect(ownerlessLists(db)).toEqual(['Verlanglijst'])
  })

  it('never reads what buyers did: the database sees to their rows when the account\'s row goes', () => {
    for (const file of ['users.ts', 'accounts.ts']) {
      expect(readFileSync(`server/domain/${file}`, 'utf8')).not.toMatch(/purchases|notes/i)
    }
  })
})
