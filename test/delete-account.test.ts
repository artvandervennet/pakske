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
import { linkWish } from '../server/domain/sharing'
import { createUser, findUserById } from '../server/domain/users'
import { setWishImage } from '../server/domain/wishes'
import { fakeIdentity, googleCredential } from './fake-identity'
import { addList, addOwner, addWishTo, expectOwnersSettled, makeDb, ownerIds, purchaseRows, titles, wishIn } from './helpers'

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

/** Live lists nobody owns: there must never be one. */
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

  it('takes along what the person was getting for others, and what they wrote about it', async () => {
    const { db, art, lot, mom, remove } = await setup()
    const book = addWishTo(db, mom.id, mom.first, 'Boek', 3)
    setPurchase(db, mom.first, book.id, art.id, 2)
    setPurchase(db, mom.first, book.id, lot.id, 1)
    addNote(db, mom.first, book.id, art.id, 'Ik haal ze in de stad.')
    addNote(db, mom.first, book.id, lot.id, 'Ik neem de derde.')
    await remove(art)
    expect(purchaseRows(db, book.id)).toEqual([{ userId: lot.id, quantity: 1 }])
    expect(db.select({ body: notes.body }).from(notes).all()).toEqual([{ body: 'Ik neem de derde.' }])
    // Mom's own page is as it was, and Lotte sees room for two again.
    expect(wishIn(getListView(db, mom.first, mom.id), book.id)).toMatchObject({ role: 'owner', mine: 0 })
    expect(wishIn(getListView(db, mom.first, lot.id), book.id)).toMatchObject({ bought: 1, purchases: [{ name: 'Lotte', quantity: 1 }] })
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
    expect(listOwnedLists(db, lot.id).map(list => list.title)).toEqual(['Verlanglijst', 'Samen'])
    expectOwnersSettled(db)
    expect(ownerlessLists(db)).toEqual([])
  })

  it('deletes a list it owns alone: gone for visitors, and marked deleted for buyers when someone was getting something from it', async () => {
    const { db, art, lot, mom, remove } = await setup()
    const sokken = addWishTo(db, art.id, art.first, 'Sokken')
    const trui = addWishTo(db, art.id, art.first, 'Trui')
    setPurchase(db, art.first, sokken.id, mom.id, 1)
    await remove(art)
    expect(getListView(db, art.first, null)).toBeUndefined()
    // As with any deleted list: what someone was getting stays for the buyers, the rest is gone.
    const forMom = getListView(db, art.first, mom.id)!
    expect(forMom).toMatchObject({ deleted: true, owners: [] })
    expect(forMom.wishes).toMatchObject([{ id: sokken.id, removed: true, mine: 1 }])
    expect(getListView(db, art.first, lot.id)!.wishes).toMatchObject([{ id: sokken.id, removed: true, mine: 0, bought: 1 }])
    const row = (id: number) => db.select().from(wishes).where(eq(wishes.id, id)).get()!
    expect(row(sokken.id).deletedAt).not.toBeNull()
    expect(row(trui.id).deletedAt).not.toBeNull()
    expectOwnersSettled(db)
    expect(ownerlessLists(db)).toEqual([])
  })

  it('leaves a wish it shares with someone on that person\'s list, and deletes the wishes only it had', async () => {
    const { db, art, lot, remove } = await setup()
    const spel = addWishTo(db, art.id, art.first, 'Bordspel')
    const eigen = addWishTo(db, art.id, art.first, 'Alleen van Art')
    linkWish(db, lot.id, art.first, spel.id, { list: lot.first })
    expect(ownerIds(db, spel.id)).toEqual([art.id, lot.id])
    await remove(art)
    expect(ownerIds(db, spel.id)).toEqual([lot.id])
    expect(wishIn(getListView(db, lot.first, lot.id), spel.id)).toMatchObject({ role: 'owner', title: 'Bordspel', coOwners: [] })
    expect(db.select().from(wishes).where(eq(wishes.id, eigen.id)).get()!.deletedAt).not.toBeNull()
    expect(db.select().from(wishes).where(eq(wishes.id, spel.id)).get()!.deletedAt).toBeNull()
    expectOwnersSettled(db)
    expect(ownerlessLists(db)).toEqual([])
  })

  it('hands back the pictures nothing points at any more', async () => {
    // Lotte links Art's wish and gives it another picture; her link keeps Art's for an undo.
    const linked = async () => {
      const world = await setup()
      const { db, art, lot } = world
      const spel = addWishTo(db, art.id, art.first, 'Bordspel')
      setWishImage(db, art.id, art.first, spel.id, 'old.png')
      linkWish(db, lot.id, art.first, spel.id, { list: lot.first })
      expect(setWishImage(db, lot.id, lot.first, spel.id, 'new.png')).toEqual({ unused: [] })
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
    const { identity, accounts, tooOld } = fakeIdentity()
    const lotte = await logInWithGoogle(db, identity, googleCredential('g-1', 'lotte@gmail.test'))
    const remove = (refreshToken?: string) => deleteAccount(db, identity, findUserById(db, lotte.user.id)!, refreshToken, undefined, legacyCheck)
    expect(await rejection(remove(undefined))).toBe('reauth_needed')
    // A login Firebase finds too long ago: nothing goes, here or there.
    tooOld.add(lotte.login.uid)
    expect(await rejection(remove(lotte.login.refreshToken))).toBe('reauth_needed')
    expect(accounts).toHaveLength(1)
    expect(findUserById(db, lotte.user.id)).toBeDefined()
    tooOld.clear()
    await remove(lotte.login.refreshToken)
    expect(accounts).toEqual([])
    expect(findUserById(db, lotte.user.id)).toBeUndefined()
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
    expect(db.select().from(lists).where(isNull(lists.deletedAt)).all()).toEqual([])
  })

  it('never reads what buyers did: the tables empty themselves when the account\'s row goes', () => {
    for (const file of ['users.ts', 'accounts.ts']) {
      expect(readFileSync(`server/domain/${file}`, 'utf8')).not.toMatch(/purchases|notes/i)
    }
  })
})
