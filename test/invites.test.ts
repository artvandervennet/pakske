import { readFileSync } from 'node:fs'
import { count, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invites, listOwners, lists, notices } from '../server/db/schema'
import { acceptInvite, createInvite, getInviteView, MAX_OPEN_INVITES } from '../server/domain/invites'
import { getListView } from '../server/domain/list-view'
import { createList, deleteList, leaveList, listOwnedLists, ownedListId } from '../server/domain/lists'
import { listNotices } from '../server/domain/notices'
import { putOnList } from '../server/domain/placement'
import { setPurchase } from '../server/domain/purchases'
import { linkWish } from '../server/domain/sharing'
import { LIST_TOKEN } from '../server/domain/tokens'
import { deleteWish, setWishImage } from '../server/domain/wishes'
import { ownerWishSchema } from '../shared/schemas/list'
import { addList, addOwner, addUser, addWishTo, codeOf, expectOwnersSettled, makeDb, ownerIds, titles, wishIn } from './helpers'

// A clock that only moves when a test moves it, so "oldest" and "the order they joined" never
// depend on two actions falling in the same millisecond.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())
const later = () => vi.setSystemTime(new Date(Date.now() + 1000))

function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lot = addUser(db, 'lot')
  const mom = addUser(db, 'mom')
  const A = addList(db, art.id)
  const game = addWishTo(db, art.id, A, 'Bordspel')
  const book = addWishTo(db, art.id, A, 'Boek')
  const L = addList(db, lot.id, 'Lijst van Lotte')
  return { db, art, lot, mom, A, game, book, L }
}

const inviteRows = (db: ReturnType<typeof makeDb>) => db.select({ n: count() }).from(invites).get()!.n
const noticeRows = (db: ReturnType<typeof makeDb>) => db.select({ n: count() }).from(notices).get()!.n

describe('a link that makes wishes joint', () => {
  it('makes a link that works once', () => {
    const { db, art, lot, mom, A, game, book, L } = setup()
    const { invite } = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id, book.id] })
    expect(invite).toMatch(LIST_TOKEN)
    expect(invite).not.toBe(A)
    later()
    expect(acceptInvite(db, lot.id, invite, { list: L })).toEqual({ token: L })
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
    expect(ownerIds(db, book.id)).toEqual([art.id, lot.id])
    expect(titles(getListView(db, L, lot.id))).toEqual(['Bordspel', 'Boek'])
    expect(codeOf(() => acceptInvite(db, mom.id, invite, { newList: 'Van mama' }))).toBe('invite_closed')
    expect(listOwnedLists(db, mom.id)).toEqual([])
    expect(getInviteView(db, invite, mom.id)).toMatchObject({ state: 'closed', wishes: [] })
    // Spent for its maker too, so they aren't told to send it on.
    expect(getInviteView(db, invite, art.id)).toMatchObject({ state: 'closed' })
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'joint_link_used', actor: 'Lot', title: 'Bordspel', more: 1, wishId: game.id, token: A }])
    expect(listNotices(db, lot.id)).toEqual([])
    expectOwnersSettled(db)
  })

  it('shows the opener the wishes and their own lists, never the address it came from', () => {
    const { db, art, lot, mom, A, game, book, L } = setup()
    setPurchase(db, A, game.id, mom.id, 1)
    setWishImage(db, art.id, A, game.id, 'bordspel.png')
    const { invite } = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [book.id, game.id] })
    const view = getInviteView(db, invite, lot.id)
    expect(view).toEqual({
      kind: 'wishes',
      state: 'open',
      from: 'Art',
      listTitle: 'Kerst',
      wishes: [
        { id: game.id, title: 'Bordspel', image: '/uploads/bordspel.png' },
        { id: book.id, title: 'Boek', image: null },
      ],
      mine: { lists: [{ token: L, title: 'Lijst van Lotte' }], last: null },
    })
    const json = JSON.stringify(view)
    expect(json).not.toContain(A)
    expect(json).not.toMatch(/purchases|notes|bought|Mom/)
    expect(getInviteView(db, 'no-such-invite-token-0', lot.id)).toBeUndefined()
  })

  it('does not let its maker use it, and stays open for someone else', () => {
    const { db, art, lot, A, game } = setup()
    const art2 = addList(db, art.id, 'Verjaardag')
    const { invite } = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id] })
    expect(getInviteView(db, invite, art.id)).toMatchObject({ state: 'own', wishes: [] })
    expect(codeOf(() => acceptInvite(db, art.id, invite, { list: art2 }))).toBe('forbidden')
    expect(titles(getListView(db, art2, art.id))).toEqual([])
    expect(getInviteView(db, invite, lot.id)).toMatchObject({ state: 'open' })
    expect(acceptInvite(db, lot.id, invite, { newList: 'Samen' }).token).toMatch(LIST_TOKEN)
    expect(listOwnedLists(db, lot.id).map(list => list.title)).toEqual(['Samen', 'Lijst van Lotte'])
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
    expectOwnersSettled(db)
  })

  it('takes only wishes on that list, from an owner of it', () => {
    const { db, art, lot, mom, A, game } = setup()
    const elsewhere = addWishTo(db, art.id, addList(db, art.id, 'Verjaardag'), 'Sokken')
    const gone = addWishTo(db, art.id, A, 'Weg')
    deleteWish(db, art.id, A, gone.id)
    expect(codeOf(() => createInvite(db, mom.id, A, { kind: 'wishes', wishIds: [game.id] }))).toBe('not_found')
    expect(codeOf(() => createInvite(db, mom.id, A, { kind: 'list' }))).toBe('not_found')
    expect(codeOf(() => createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id, elsewhere.id] }))).toBe('not_found')
    expect(codeOf(() => createInvite(db, art.id, A, { kind: 'wishes', wishIds: [gone.id] }))).toBe('not_found')
    expect(codeOf(() => createInvite(db, art.id, 'no-such-list-token-00', { kind: 'list' }))).toBe('not_found')
    deleteList(db, art.id, A)
    expect(codeOf(() => createInvite(db, art.id, A, { kind: 'list' }))).toBe('not_found')
    expect(inviteRows(db)).toBe(0)
    // A co-owner of the list may make one.
    const M = addList(db, mom.id, 'Moederdag')
    const vase = addWishTo(db, mom.id, M, 'Vaas')
    addOwner(db, M, lot.id)
    expect(createInvite(db, lot.id, M, { kind: 'wishes', wishIds: [vase.id, vase.id] }).invite).toMatch(LIST_TOKEN)
  })

  it('needs a list to put the wishes on', () => {
    const { db, art, lot, A, game } = setup()
    const { invite } = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id] })
    expect(codeOf(() => acceptInvite(db, lot.id, invite, null))).toBe('validation')
    expect(codeOf(() => acceptInvite(db, lot.id, invite, { list: A }))).toBe('not_found')
    expect(codeOf(() => acceptInvite(db, lot.id, 'no-such-invite-token-0', { newList: 'Samen' }))).toBe('not_found')
    expect(getInviteView(db, invite, lot.id)).toMatchObject({ state: 'open' })
    expect(ownerIds(db, game.id)).toEqual([art.id])
  })

  it('skips a wish deleted meanwhile and closes when none is left', () => {
    const { db, art, lot, mom, A, game, book, L } = setup()
    const first = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id, book.id] }).invite
    const second = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id] }).invite
    deleteWish(db, art.id, A, game.id)
    expect(getInviteView(db, first, lot.id)).toMatchObject({ state: 'open', wishes: [{ id: book.id, title: 'Boek' }] })
    expect(getInviteView(db, second, lot.id)).toMatchObject({ state: 'closed', wishes: [] })
    expect(codeOf(() => acceptInvite(db, mom.id, second, { newList: 'Van mama' }))).toBe('invite_closed')
    expect(listOwnedLists(db, mom.id)).toEqual([])

    acceptInvite(db, lot.id, first, { list: L })
    expect(titles(getListView(db, L, lot.id))).toEqual(['Boek'])
    expect(ownerIds(db, game.id)).toEqual([])
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'joint_link_used', title: 'Boek', more: 0, wishId: book.id }])
    expectOwnersSettled(db)
  })

  it('closes when its maker no longer owns the list, or the list is gone', () => {
    const { db, art, lot, mom, A, game } = setup()
    addOwner(db, A, mom.id)
    const byMom = createInvite(db, mom.id, A, { kind: 'list' }).invite
    const byArt = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id] }).invite
    leaveList(db, mom.id, A)
    expect(getInviteView(db, byMom, lot.id)).toMatchObject({ state: 'closed' })
    expect(codeOf(() => acceptInvite(db, lot.id, byMom, null))).toBe('invite_closed')
    expect(getInviteView(db, byArt, lot.id)).toMatchObject({ state: 'open' })
    deleteList(db, art.id, A)
    expect(getInviteView(db, byArt, lot.id)).toMatchObject({ state: 'closed', wishes: [] })
    expect(codeOf(() => acceptInvite(db, lot.id, byArt, { newList: 'Samen' }))).toBe('invite_closed')
    expect(listOwnedLists(db, lot.id)).toHaveLength(1)
  })

  it('makes the accepter an owner who no longer sees purchases on those wishes', () => {
    const { db, art, lot, mom, A, game, L } = setup()
    setPurchase(db, A, game.id, lot.id, 1)
    addOwner(db, A, mom.id)
    expect(wishIn(getListView(db, A, lot.id), game.id)).toMatchObject({ role: 'buyer', bought: 1 })
    const { invite } = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id] })
    acceptInvite(db, lot.id, invite, { list: L })
    for (const [token, sharedWith] of [[A, []], [L, ['Art', 'Mom']]] as const) {
      const wish = wishIn(getListView(db, token, lot.id), game.id)
      expect(wish).toEqual(expect.objectContaining({ role: 'owner', mine: 1 }))
      // The other owners are named as owners, and nowhere else: nothing about who bought it.
      const { coOwners, sharedWith: named, ...rest } = ownerWishSchema.parse(wish)
      expect(coOwners.map(owner => owner.name)).toEqual(['Art', 'Mom'])
      expect(named).toEqual(sharedWith)
      expect(JSON.stringify(rest)).not.toMatch(/Lot|Mom|Art/)
    }
    // Only the maker is told, not the list's other owner.
    expect(listNotices(db, art.id)).toHaveLength(1)
    expect(listNotices(db, mom.id)).toEqual([])
    expectOwnersSettled(db)
  })

  it('leaves a wish where it is when it is on that list already', () => {
    const { db, art, lot, A, game, book, L } = setup()
    linkWish(db, lot.id, A, game.id, { list: L })
    const { invite } = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id, book.id] })
    acceptInvite(db, lot.id, invite, { list: L })
    expect(titles(getListView(db, L, lot.id))).toEqual(['Bordspel', 'Boek'])
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'joint_link_used', title: 'Bordspel', more: 1 }, { kind: 'wish_linked' }])
    expectOwnersSettled(db)
  })

  it('refuses when the wishes do not fit on the list, and stays open', () => {
    const { db, art, lot, A, game, book, L } = setup()
    for (let i = 0; i < 199; i++) addWishTo(db, lot.id, L, `Wens ${i}`)
    const { invite } = createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id, book.id] })
    expect(codeOf(() => acceptInvite(db, lot.id, invite, { list: L }))).toBe('wish_limit')
    expect(ownerIds(db, game.id)).toEqual([art.id])
    expect(ownerIds(db, book.id)).toEqual([art.id])
    expect(noticeRows(db)).toBe(0)
    expect(getInviteView(db, invite, lot.id)).toMatchObject({ state: 'open' })
    expect(acceptInvite(db, lot.id, invite, { newList: 'Samen' }).token).toMatch(LIST_TOKEN)
  })

  it('keeps at most 20 unused links per list', () => {
    const { db, art, lot, A, game, L } = setup()
    expect(MAX_OPEN_INVITES).toBe(20)
    const used = createInvite(db, art.id, A, { kind: 'list' }).invite
    acceptInvite(db, lot.id, used, null)
    const made: string[] = []
    for (let i = 0; i < 20; i++) {
      later()
      made.push(createInvite(db, art.id, A, { kind: 'wishes', wishIds: [game.id] }).invite)
    }
    expect(getInviteView(db, made[0]!, lot.id)).toBeDefined()
    // Another list's links don't count.
    createInvite(db, lot.id, L, { kind: 'list' })
    later()
    const last = createInvite(db, art.id, A, { kind: 'list' }).invite
    expect(getInviteView(db, made[0]!, lot.id)).toBeUndefined()
    expect(getInviteView(db, made[1]!, lot.id)).toBeDefined()
    expect(getInviteView(db, last, lot.id)).toBeDefined()
    // A used link isn't one of the 20.
    expect(getInviteView(db, used, lot.id)).toMatchObject({ state: 'closed' })
    expect(inviteRows(db)).toBe(1 + 20 + 1)
  })
})

describe('a joint list', () => {
  it('makes a co-owner an owner of the list and of every wish on it, now and later', () => {
    const { db, art, lot, A, game, book } = setup()
    const { invite } = createInvite(db, art.id, A, { kind: 'list' })
    expect(getInviteView(db, invite, lot.id)).toMatchObject({ kind: 'list', state: 'open', from: 'Art', listTitle: 'Kerst', wishes: [] })
    expect(JSON.stringify(getInviteView(db, invite, lot.id))).not.toContain(A)
    later()
    expect(acceptInvite(db, lot.id, invite, null)).toEqual({ token: A })
    expect(listOwnedLists(db, lot.id)).toContainEqual({ token: A, title: 'Kerst', wishes: 2, owners: ['Art', 'Lot'], sharedWith: ['Art'] })
    expect(listOwnedLists(db, art.id)).toEqual([{ token: A, title: 'Kerst', wishes: 2, owners: ['Art', 'Lot'], sharedWith: ['Lot'] }])
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
    expect(ownerIds(db, book.id)).toEqual([art.id, lot.id])
    expect(ownerIds(db, addWishTo(db, art.id, A, 'Lamp').id)).toEqual([art.id, lot.id])
    expect(ownerIds(db, addWishTo(db, lot.id, A, 'Vaas').id)).toEqual([art.id, lot.id])
    expect(getListView(db, A, lot.id)).toMatchObject({ viewerOwnsList: true, owners: ['Art', 'Lot'] })
    expect(codeOf(() => acceptInvite(db, lot.id, invite, null))).toBe('invite_closed')
    expectOwnersSettled(db)
  })

  it('tells the earlier owners', () => {
    const { db, art, lot, mom, A } = setup()
    acceptInvite(db, lot.id, createInvite(db, art.id, A, { kind: 'list' }).invite, null)
    later()
    acceptInvite(db, mom.id, createInvite(db, lot.id, A, { kind: 'list' }).invite, null)
    expect(listNotices(db, art.id)).toMatchObject([
      { kind: 'list_joined', actor: 'Mom', title: 'Kerst', token: A, wishId: null },
      { kind: 'list_joined', actor: 'Lot', title: 'Kerst', token: A, wishId: null },
    ])
    expect(listNotices(db, lot.id)).toMatchObject([{ kind: 'list_joined', actor: 'Mom', title: 'Kerst', token: A }])
    expect(listNotices(db, mom.id)).toEqual([])
    expect(listOwnedLists(db, art.id)[0]!.sharedWith).toEqual(['Lot', 'Mom'])
    expect(listOwnedLists(db, mom.id)[0]!.sharedWith).toEqual(['Art', 'Lot'])
  })

  it('does not let someone who owns the list already use a link to it', () => {
    const { db, art, lot, mom, A } = setup()
    addOwner(db, A, lot.id)
    const { invite } = createInvite(db, art.id, A, { kind: 'list' })
    expect(codeOf(() => acceptInvite(db, art.id, invite, null))).toBe('forbidden')
    expect(codeOf(() => acceptInvite(db, lot.id, invite, null))).toBe('forbidden')
    expect(noticeRows(db)).toBe(0)
    expect(acceptInvite(db, mom.id, invite, null)).toEqual({ token: A })
  })

  it('lets any co-owner take a wish off, for all of them', () => {
    const { db, art, lot, A, game } = setup()
    acceptInvite(db, lot.id, createInvite(db, art.id, A, { kind: 'list' }).invite, null)
    deleteWish(db, lot.id, A, game.id)
    expect(ownerIds(db, game.id)).toEqual([])
    expect(titles(getListView(db, A, art.id))).toEqual(['Boek'])
    expectOwnersSettled(db)
  })

  it('cannot be deleted while it has several owners', () => {
    const { db, art, lot, A } = setup()
    acceptInvite(db, lot.id, createInvite(db, art.id, A, { kind: 'list' }).invite, null)
    expect(codeOf(() => deleteList(db, art.id, A))).toBe('list_shared')
    expect(codeOf(() => deleteList(db, lot.id, A))).toBe('list_shared')
    expect(titles(getListView(db, A, art.id))).toEqual(['Bordspel', 'Boek'])
  })

  it('lets someone leave: the list and its wishes are no longer theirs, except a wish on another list of theirs', () => {
    const { db, art, lot, mom, A, game, book, L } = setup()
    acceptInvite(db, lot.id, createInvite(db, art.id, A, { kind: 'list' }).invite, null)
    putOnList(db, ownedListId(db, lot.id, L), game.id)
    setPurchase(db, A, book.id, mom.id, 1)

    leaveList(db, lot.id, A)
    expect(listOwnedLists(db, lot.id)).toEqual([{ token: L, title: 'Lijst van Lotte', wishes: 1, owners: ['Lot'], sharedWith: [] }])
    expect(listOwnedLists(db, art.id)).toEqual([{ token: A, title: 'Kerst', wishes: 2, owners: ['Art'], sharedWith: [] }])
    expect(ownerIds(db, book.id)).toEqual([art.id])
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
    expect(titles(getListView(db, A, art.id))).toEqual(['Bordspel', 'Boek'])
    expect(getListView(db, A, lot.id)).toMatchObject({ viewerOwnsList: false, owners: ['Art'] })
    expect(codeOf(() => leaveList(db, lot.id, A))).toBe('not_found')
    expect(codeOf(() => deleteWish(db, lot.id, A, book.id))).toBe('not_found')
    expect(noticeRows(db)).toBe(1) // only Art's "list_joined"
    // With one owner left, the list can be deleted again.
    deleteList(db, art.id, A)
    expect(ownerIds(db, game.id)).toEqual([lot.id])
    expectOwnersSettled(db)
  })

  it('does not let the last owner leave, who can delete it', () => {
    const { db, art, mom, A } = setup()
    expect(codeOf(() => leaveList(db, art.id, A))).toBe('last_owner')
    expect(codeOf(() => leaveList(db, mom.id, A))).toBe('not_found')
    expect(listOwnedLists(db, art.id)).toHaveLength(1)
    deleteList(db, art.id, A)
    expect(listOwnedLists(db, art.id)).toEqual([])
    expect(codeOf(() => leaveList(db, art.id, A))).toBe('not_found')
  })

  it('refuses a 51st list for the accepter', () => {
    const { db, art, mom, A } = setup()
    for (let i = 0; i < 50; i++) createList(db, mom.id, `Lijst ${i}`)
    const { invite } = createInvite(db, art.id, A, { kind: 'list' })
    expect(codeOf(() => acceptInvite(db, mom.id, invite, null))).toBe('list_limit')
    expect(db.select().from(listOwners).innerJoin(lists, eq(lists.id, listOwners.listId)).where(eq(lists.token, A)).all()).toHaveLength(1)
    expect(noticeRows(db)).toBe(0)
    expect(getInviteView(db, invite, mom.id)).toMatchObject({ state: 'open' })
  })
})

it('server/domain/invites.ts never touches purchases or notes', () => {
  expect(readFileSync('server/domain/invites.ts', 'utf8')).not.toMatch(/purchases|notes/i)
})
