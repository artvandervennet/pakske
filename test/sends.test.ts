import { count } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invites, notices } from '../server/db/schema'
import { acceptFriendLink, listFriendsForList, makeFriendLink, removeFriend } from '../server/domain/friends'
import { acceptInvite, COPY_LINK_DAYS, createInvite, getInviteView, listInviteLink, MAX_OPEN_INVITES, MAX_WAITING_SENDS, sendInvite, SENT_LIST_DAYS } from '../server/domain/invites'
import { getListView } from '../server/domain/list-view'
import { leaveList, listOwnedLists } from '../server/domain/lists'
import { countUnseen, listNotices } from '../server/domain/notices'
import { dismissNotice, dismissNotices } from '../server/domain/undo'
import { deleteUser } from '../server/domain/users'
import { deleteWish } from '../server/domain/wishes'
import { inviteInput, listFriendInput } from '../shared/schemas/input'
import { addList, addOwner, addUser, addWishTo, codeOf, expectOwnersSettled, makeDb, ownerIds, titles } from './helpers'

// Sending to a friend: what a share link gives, delivered as a notice to one friend instead of
// as an address to pass on. A clock that only moves when a test moves it keeps "oldest" from
// depending on two sends falling in the same millisecond.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())
const later = (ms = 1000) => vi.setSystemTime(new Date(Date.now() + ms))

type TestDb = ReturnType<typeof makeDb>
const friends = (db: TestDb, a: number, b: number) => acceptFriendLink(db, b, makeFriendLink(db, a).token)
const inviteRows = (db: TestDb) => db.select({ n: count() }).from(invites).get()!.n
const noticeRows = (db: TestDb) => db.select({ n: count() }).from(notices).get()!.n
/** The notices about something sent, without the ones about becoming friends. */
const sent = (db: TestDb, userId: number) => listNotices(db, userId).filter(notice => notice.kind.startsWith('sent_'))

function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lot = addUser(db, 'lot')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const A = addList(db, art.id)
  const game = addWishTo(db, art.id, A, 'Bordspel')
  const book = addWishTo(db, art.id, A, 'Boek')
  const L = addList(db, lot.id, 'Lijst van Lotte')
  friends(db, art.id, lot.id)
  friends(db, art.id, mom.id)
  // Becoming friends leaves notices of its own; the tests below start without any.
  db.delete(notices).run()
  return { db, art, lot, mom, sis, A, game, book, L }
}

describe('sending wishes to a friend', () => {
  it('leaves the friend a notice that leads to what a link would have given', () => {
    const { db, art, lot, A, game, book, L } = setup()
    expect(sendInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [book.id, game.id] }, [lot.id])).toEqual({ sent: 1 })
    const [notice] = listNotices(db, lot.id)
    // Named after the first wish in the list's order, whatever order they were ticked in.
    expect(notice).toMatchObject({ kind: 'sent_linked', actor: 'Art', actorId: art.id, title: 'Bordspel', more: 1, token: null, canUndo: false, fresh: true })
    expect(countUnseen(db, lot.id)).toBe(1)
    expect(getInviteView(db, notice!.invite!, lot.id)).toMatchObject({ kind: 'wishes', mode: 'linked', state: 'open', from: 'Art', yours: false })
    // Nothing changed yet: the friend decides.
    expect(ownerIds(db, game.id)).toEqual([art.id])

    later()
    expect(acceptInvite(db, lot.id, notice!.invite!, { list: L })).toEqual({ token: L })
    expect(ownerIds(db, game.id)).toEqual([art.id, lot.id])
    expect(titles(getListView(db, L, lot.id))).toEqual(['Bordspel', 'Boek'])
    // Answered, so nothing of it waits any more; the sender is told it was a yes.
    expect(listNotices(db, lot.id)).toEqual([])
    expect(inviteRows(db)).toBe(0)
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'share_accepted', actor: 'Lot', title: 'Bordspel', more: 1, wishId: game.id, token: A }])
    expectOwnersSettled(db)
  })

  it('gives every friend a send of their own, also for copies', () => {
    const { db, art, lot, mom, A, game, L } = setup()
    expect(sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [game.id] }, [lot.id, mom.id, lot.id])).toEqual({ sent: 2 })
    const toLot = sent(db, lot.id)[0]!
    const toMom = sent(db, mom.id)[0]!
    expect(toLot).toMatchObject({ kind: 'sent_copy', title: 'Bordspel', more: 0 })
    expect(toMom.invite).not.toBe(toLot.invite)

    acceptInvite(db, lot.id, toLot.invite!, { list: L })
    expect(titles(getListView(db, L, lot.id))).toEqual(['Bordspel'])
    expect(sent(db, lot.id)).toEqual([])
    // Mom's is still hers to take, and a copy tells its sender nothing.
    expect(getInviteView(db, toMom.invite!, mom.id)).toMatchObject({ state: 'open' })
    expect(listNotices(db, art.id)).toEqual([])
    expect(ownerIds(db, game.id)).toEqual([art.id])
  })

  it('works only for the friend it was sent to', () => {
    const { db, art, lot, mom, sis, A, game } = setup()
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [game.id] }, [lot.id])
    const token = sent(db, lot.id)[0]!.invite!
    for (const other of [mom, sis, art]) {
      expect(getInviteView(db, token, other.id)).toBeUndefined()
      expect(codeOf(() => acceptInvite(db, other.id, token, { newList: 'Nieuw' }))).toBe('not_found')
    }
    expect(ownerIds(db, game.id)).toEqual([art.id])
    expect(getInviteView(db, token, lot.id)).toMatchObject({ state: 'open' })
  })

  it('refuses someone who is no friend, and sends to nobody then', () => {
    const { db, art, lot, sis, A, game } = setup()
    expect(codeOf(() => sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [game.id] }, [lot.id, sis.id]))).toBe('not_friends')
    expect(codeOf(() => sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [game.id] }, [art.id]))).toBe('not_friends')
    expect(inviteRows(db)).toBe(0)
    expect(noticeRows(db)).toBe(0)
  })

  it('refuses a list that isn\'t the sender\'s and wishes that aren\'t on it', () => {
    const { db, art, lot, A, game, L } = setup()
    const other = addWishTo(db, lot.id, L, 'Lamp')
    expect(codeOf(() => sendInvite(db, lot.id, A, { kind: 'wishes', mode: 'copy', wishIds: [game.id] }, [art.id]))).toBe('not_found')
    expect(codeOf(() => sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [game.id, other.id] }, [lot.id]))).toBe('not_found')
    expect(inviteRows(db)).toBe(0)
  })

  it('replaces an earlier send of the same wishes in the same way', () => {
    const { db, art, lot, A, game, book } = setup()
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [game.id, book.id] }, [lot.id])
    const first = sent(db, lot.id)[0]!.invite!
    later()
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [book.id, game.id] }, [lot.id])
    expect(sent(db, lot.id)).toHaveLength(1)
    expect(getInviteView(db, first, lot.id)).toBeUndefined()
    // Other wishes, or the same ones another way, are another send.
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [game.id] }, [lot.id])
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [book.id, game.id] }, [lot.id])
    expect(sent(db, lot.id)).toHaveLength(3)
    expect(inviteRows(db)).toBe(3)
  })

  it('keeps at most a fixed number waiting for one friend, the oldest going first', () => {
    const { db, art, lot, mom, A, game } = setup()
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [game.id] }, [lot.id, mom.id])
    const first = sent(db, lot.id)[0]!.invite!
    for (let n = 0; n < MAX_WAITING_SENDS; n++) {
      later()
      const wish = addWishTo(db, art.id, A, `Wens ${n}`)
      sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [wish.id] }, [lot.id])
    }
    expect(sent(db, lot.id)).toHaveLength(MAX_WAITING_SENDS)
    expect(getInviteView(db, first, lot.id)).toBeUndefined()
    // What waits for another friend is counted apart.
    expect(sent(db, mom.id)).toHaveLength(1)
  })

  it('stays out of the count of a list\'s open links, both ways', () => {
    const { db, art, lot, mom, A, game } = setup()
    const { invite } = createInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [game.id] })
    for (let n = 0; n < MAX_OPEN_INVITES + 2; n++) {
      later()
      const wish = addWishTo(db, art.id, A, `Wens ${n}`)
      sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [wish.id] }, n % 2 ? [lot.id] : [mom.id])
    }
    expect(getInviteView(db, invite, mom.id)).toMatchObject({ state: 'open' })
    const waiting = sent(db, lot.id).length + sent(db, mom.id).length
    for (let n = 0; n < MAX_OPEN_INVITES; n++) {
      later()
      createInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [game.id] })
    }
    expect(sent(db, lot.id).length + sent(db, mom.id).length).toBe(waiting)
    expect(getInviteView(db, invite, mom.id)).toBeUndefined()
  })
})

describe('sending a list to manage together', () => {
  it('makes the friend a co-owner once they say yes', () => {
    const { db, art, lot, A } = setup()
    expect(sendInvite(db, art.id, A, { kind: 'list' }, [lot.id])).toEqual({ sent: 1 })
    const [notice] = listNotices(db, lot.id)
    expect(notice).toMatchObject({ kind: 'sent_list', actor: 'Art', title: 'Kerst', more: 0, token: null })
    expect(listOwnedLists(db, lot.id).map(list => list.token)).not.toContain(A)
    later()
    expect(acceptInvite(db, lot.id, notice!.invite!, null)).toEqual({ token: A })
    expect(listOwnedLists(db, lot.id).map(list => list.token)).toContain(A)
    expect(listNotices(db, lot.id)).toEqual([])
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'list_joined', actor: 'Lot', title: 'Kerst', token: A }])
    expect(inviteRows(db)).toBe(0)
  })

  it('is gone once the friend joined through the link that goes round', () => {
    const { db, art, lot, A } = setup()
    sendInvite(db, art.id, A, { kind: 'list' }, [lot.id])
    const token = sent(db, lot.id)[0]!.invite!
    acceptInvite(db, lot.id, listInviteLink(db, art.id, A).invite, null)
    expect(sent(db, lot.id)).toEqual([])
    expect(getInviteView(db, token, lot.id)).toBeUndefined()
    // Only the link is left.
    expect(inviteRows(db)).toBe(1)
  })

  it('refuses a friend who owns the list already', () => {
    const { db, art, lot, A } = setup()
    addOwner(db, A, lot.id)
    expect(codeOf(() => sendInvite(db, art.id, A, { kind: 'list' }, [lot.id]))).toBe('forbidden')
    expect(inviteRows(db)).toBe(0)
  })
})

describe('what was sent and can no longer be taken', () => {
  it('is gone for the friend, notice and mark, once its wishes left the list', () => {
    const { db, art, lot, A, game, book } = setup()
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [game.id] }, [lot.id])
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [book.id] }, [lot.id])
    expect(countUnseen(db, lot.id)).toBe(2)
    deleteWish(db, art.id, A, game.id)
    expect(sent(db, lot.id)).toMatchObject([{ kind: 'sent_copy', title: 'Boek' }])
    expect(countUnseen(db, lot.id)).toBe(1)
  })

  it('is gone once its sender left the list', () => {
    const { db, art, lot, mom, A } = setup()
    addOwner(db, A, mom.id)
    sendInvite(db, art.id, A, { kind: 'list' }, [lot.id])
    const token = sent(db, lot.id)[0]!.invite!
    leaveList(db, art.id, A)
    expect(sent(db, lot.id)).toEqual([])
    expect(countUnseen(db, lot.id)).toBe(0)
    // Deleted with the sender's leaving, so it stays gone if they join the list again.
    expect(codeOf(() => acceptInvite(db, lot.id, token, null))).toBe('not_found')
    expect(inviteRows(db)).toBe(0)
  })

  it('is gone when copies were sent more than thirty days ago', () => {
    const { db, art, lot, A, game } = setup()
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [game.id] }, [lot.id])
    later(COPY_LINK_DAYS * 24 * 60 * 60 * 1000 - 2000)
    expect(sent(db, lot.id)).toHaveLength(1)
    later(2000)
    expect(sent(db, lot.id)).toEqual([])
  })

  it('is taken back when the friend closes the notice, and nobody is told', () => {
    const { db, art, lot, A, game } = setup()
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [game.id] }, [lot.id])
    const notice = sent(db, lot.id)[0]!
    dismissNotice(db, lot.id, notice.id)
    expect(getInviteView(db, notice.invite!, lot.id)).toBeUndefined()
    expect(inviteRows(db)).toBe(0)
    expect(listNotices(db, art.id)).toEqual([])
  })

  it('stays when the friend clears their notices: only closing it by itself is a no', () => {
    const { db, art, lot, A, game } = setup()
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [game.id] }, [lot.id])
    sendInvite(db, art.id, A, { kind: 'list' }, [lot.id])
    dismissNotices(db, lot.id, listNotices(db, lot.id).map(notice => notice.id))
    expect(sent(db, lot.id).map(notice => notice.kind).sort()).toEqual(['sent_linked', 'sent_list'])
    expect(inviteRows(db)).toBe(2)
    expect(acceptInvite(db, lot.id, sent(db, lot.id).find(notice => notice.kind === 'sent_list')!.invite!, null)).toBeTruthy()
  })

  it('goes with the friendship, in both directions', () => {
    const { db, art, lot, mom, A, game, L } = setup()
    const lamp = addWishTo(db, lot.id, L, 'Lamp')
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [game.id] }, [lot.id, mom.id])
    sendInvite(db, lot.id, L, { kind: 'wishes', mode: 'copy', wishIds: [lamp.id] }, [art.id])
    removeFriend(db, art.id, lot.id)
    expect(sent(db, lot.id)).toEqual([])
    expect(sent(db, art.id)).toEqual([])
    expect(sent(db, mom.id)).toHaveLength(1)
    expect(inviteRows(db)).toBe(1)
  })

  it('goes with either account', () => {
    const { db, art, lot, mom, A, game } = setup()
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'linked', wishIds: [game.id] }, [lot.id, mom.id])
    deleteUser(db, lot.id)
    expect(inviteRows(db)).toBe(1)
    deleteUser(db, art.id)
    expect(inviteRows(db)).toBe(0)
    expect(listNotices(db, mom.id).filter(notice => notice.kind.startsWith('sent_'))).toEqual([])
  })
})

describe('an invitation to a list that a friend closed', () => {
  const invitedTo = (db: TestDb, ownerId: number, token: string) => listFriendsForList(db, ownerId, token).filter(friend => friend.invited).map(friend => friend.name)

  it('reads to its sender exactly like one that waits', () => {
    const { db, art, lot, mom, A } = setup()
    sendInvite(db, art.id, A, { kind: 'list' }, [lot.id, mom.id])
    expect(invitedTo(db, art.id, A)).toEqual(['Lot', 'Mom'])
    const notice = sent(db, lot.id)[0]!
    dismissNotice(db, lot.id, notice.id)
    // Lot is rid of it, and it gives her nothing any more.
    expect(sent(db, lot.id)).toEqual([])
    expect(countUnseen(db, lot.id)).toBe(0)
    expect(getInviteView(db, notice.invite!, lot.id)).toBeUndefined()
    expect(codeOf(() => acceptInvite(db, lot.id, notice.invite!, null))).toBe('not_found')
    // Art sees no difference between her and Mom, who said nothing.
    expect(invitedTo(db, art.id, A)).toEqual(['Lot', 'Mom'])
    expect(listNotices(db, art.id)).toEqual([])
  })

  it('isn\'t put before the friend again while its days last, and says nothing about that', () => {
    const { db, art, lot, A } = setup()
    sendInvite(db, art.id, A, { kind: 'list' }, [lot.id])
    dismissNotice(db, lot.id, sent(db, lot.id)[0]!.id)
    later()
    expect(sendInvite(db, art.id, A, { kind: 'list' }, [lot.id])).toEqual({ sent: 1 })
    expect(sent(db, lot.id)).toEqual([])
    expect(inviteRows(db)).toBe(1)
  })

  it('ends after 30 days, declined or not, and the friend can be asked again', () => {
    const { db, art, lot, mom, A } = setup()
    expect(SENT_LIST_DAYS).toBe(30)
    sendInvite(db, art.id, A, { kind: 'list' }, [lot.id, mom.id])
    dismissNotice(db, lot.id, sent(db, lot.id)[0]!.id)
    later(SENT_LIST_DAYS * 24 * 60 * 60 * 1000 - 5000)
    expect(invitedTo(db, art.id, A)).toEqual(['Lot', 'Mom'])
    expect(sent(db, mom.id)).toHaveLength(1)
    later(5000)
    // Both are back among the people to invite at the same moment.
    expect(invitedTo(db, art.id, A)).toEqual([])
    expect(sent(db, mom.id)).toEqual([])
    sendInvite(db, art.id, A, { kind: 'list' }, [lot.id])
    expect(sent(db, lot.id)).toMatchObject([{ kind: 'sent_list' }])
    expect(invitedTo(db, art.id, A)).toEqual(['Lot'])
  })

  it('is no longer among the invited once the friend said yes: they own the list', () => {
    const { db, art, lot, A } = setup()
    sendInvite(db, art.id, A, { kind: 'list' }, [lot.id])
    acceptInvite(db, lot.id, sent(db, lot.id)[0]!.invite!, null)
    expect(listFriendsForList(db, art.id, A).map(friend => friend.name)).toEqual(['Mom'])
  })

  it('leaves wishes that were sent as they were: closing the notice takes those away', () => {
    const { db, art, lot, A, game } = setup()
    sendInvite(db, art.id, A, { kind: 'wishes', mode: 'copy', wishIds: [game.id] }, [lot.id])
    dismissNotice(db, lot.id, sent(db, lot.id)[0]!.id)
    expect(inviteRows(db)).toBe(0)
  })
})

describe('what a send may ask', () => {
  it('switches one friend one way at a time', () => {
    expect(listFriendInput.safeParse({ shown: true }).success).toBe(true)
    expect(listFriendInput.safeParse({ invited: true }).success).toBe(true)
    // An invitation is not taken back here: it ends by itself.
    expect(listFriendInput.safeParse({ invited: false }).success).toBe(false)
    expect(listFriendInput.safeParse({}).success).toBe(false)
    expect(listFriendInput.safeParse({ shown: true, invited: true }).success).toBe(false)
    expect(listFriendInput.safeParse({ shown: 'yes' }).success).toBe(false)
  })

  it('takes up to twenty friends, each a positive whole number', () => {
    const wishes = { kind: 'wishes', mode: 'copy', wishIds: [1] }
    expect(inviteInput.safeParse({ ...wishes, friends: [3, 4] }).success).toBe(true)
    expect(inviteInput.safeParse({ kind: 'list', friends: [3] }).success).toBe(true)
    expect(inviteInput.safeParse({ ...wishes, friends: [] }).success).toBe(false)
    expect(inviteInput.safeParse({ ...wishes, friends: [0] }).success).toBe(false)
    expect(inviteInput.safeParse({ ...wishes, friends: Array.from({ length: 21 }, (_, n) => n + 1) }).success).toBe(false)
    // Without friends it is a link, as before.
    expect(inviteInput.safeParse(wishes).success).toBe(true)
  })
})
