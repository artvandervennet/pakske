import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { friendRequests, friendships } from '../server/db/schema'
import {
  answerRequest, areFriends, askFriend, countFreshRequests, listRequests, markRequestsSeen, MAX_FRIENDS,
  MAX_WAITING_REQUESTS, removeFriend, withdrawRequest,
} from '../server/domain/friends'
import { deleteList, relinkList } from '../server/domain/lists'
import { listNotices } from '../server/domain/notices'
import { deleteUser } from '../server/domain/users'
import { addList, addOwner, addUser, codeOf, makeDb } from './helpers'

// A clock that only moves when a test moves it, so "newest first" never depends on two actions
// falling in the same millisecond.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())
const later = () => vi.setSystemTime(new Date(Date.now() + 1000))

/** Art, Lotte and Mom; Art's list "Kerst" and Mom's own list. Nobody is friends yet. */
function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lot = addUser(db, 'lot')
  const mom = addUser(db, 'mom')
  const kerst = addList(db, art.id, 'Kerst')
  const momList = addList(db, mom.id, 'Lijst van mom')
  return { db, art, lot, mom, kerst, momList }
}

const requestRows = (db: ReturnType<typeof makeDb>) => db.select().from(friendRequests).all()
const friendshipRows = (db: ReturnType<typeof makeDb>) => db.select().from(friendships).all()

/** Makes two people friends the short way: one asks, the other accepts. */
export function befriend(db: ReturnType<typeof makeDb>, asker: number, listToken: string, owner: number) {
  expect(askFriend(db, asker, listToken, owner)).toBe('asked')
  const request = listRequests(db, owner).incoming.find(row => row.fromId === asker)!
  expect(answerRequest(db, owner, request.id, true)).toEqual({ friendId: asker })
}

describe('asking to be friends', () => {
  it('leaves the owner of a list a request that names the sender and the list', () => {
    const { db, art, mom, kerst } = setup()
    expect(askFriend(db, mom.id, kerst, art.id)).toBe('asked')
    expect(listRequests(db, art.id).incoming).toMatchObject([{ fromId: mom.id, from: 'Mom', via: 'Kerst', fresh: true }])
    expect(listRequests(db, art.id).outgoing).toEqual([])
    expect(listRequests(db, mom.id).outgoing).toMatchObject([{ toId: art.id, to: 'Art' }])
    expect(listRequests(db, mom.id).incoming).toEqual([])
    expect(areFriends(db, art.id, mom.id)).toBe(false)
    // Nobody else hears of it.
    expect(listNotices(db, art.id)).toEqual([])
  })

  it('needs a list the other person owns, and someone else than yourself', () => {
    const { db, art, lot, mom, kerst } = setup()
    expect(codeOf(() => askFriend(db, mom.id, kerst, lot.id))).toBe('not_found')
    expect(codeOf(() => askFriend(db, mom.id, 'no-such-list-token-000', art.id))).toBe('not_found')
    expect(codeOf(() => askFriend(db, art.id, kerst, art.id))).toBe('forbidden')
    deleteList(db, art.id, kerst)
    expect(codeOf(() => askFriend(db, mom.id, kerst, art.id))).toBe('not_found')
    expect(requestRows(db)).toEqual([])
  })

  it('makes them friends when the owner accepts, and tells the sender', () => {
    const { db, art, mom, kerst } = setup()
    askFriend(db, mom.id, kerst, art.id)
    const [request] = listRequests(db, art.id).incoming
    expect(answerRequest(db, art.id, request!.id, true)).toEqual({ friendId: mom.id })
    expect(areFriends(db, art.id, mom.id)).toBe(true)
    expect(areFriends(db, mom.id, art.id)).toBe(true)
    expect(requestRows(db)).toEqual([])
    expect(friendshipRows(db)).toHaveLength(1)
    expect(listNotices(db, mom.id)).toMatchObject([{ kind: 'friend_accepted', actor: 'Art', actorId: art.id, title: '', token: null }])
    expect(listNotices(db, art.id)).toEqual([])
    // Friends already: asking again changes nothing.
    expect(askFriend(db, mom.id, kerst, art.id)).toBe('friends')
    expect(requestRows(db)).toEqual([])
  })

  it('declines in silence: to the sender it still waits, and nothing of theirs reaches the owner again', () => {
    const { db, art, mom, kerst, momList } = setup()
    askFriend(db, mom.id, kerst, art.id)
    const [request] = listRequests(db, art.id).incoming
    expect(answerRequest(db, art.id, request!.id, false)).toBeNull()
    expect(listRequests(db, art.id).incoming).toEqual([])
    expect(listRequests(db, mom.id).outgoing).toMatchObject([{ toId: art.id }])
    expect(listNotices(db, mom.id)).toEqual([])
    expect(areFriends(db, art.id, mom.id)).toBe(false)
    // Asking again says the same as the first time and reaches nobody.
    expect(askFriend(db, mom.id, kerst, art.id)).toBe('asked')
    expect(listRequests(db, art.id).incoming).toEqual([])
    // Withdrawing it takes it off her page; the decline stays.
    withdrawRequest(db, mom.id, request!.id)
    expect(listRequests(db, mom.id).outgoing).toEqual([])
    expect(askFriend(db, mom.id, kerst, art.id)).toBe('asked')
    expect(listRequests(db, mom.id).outgoing).toMatchObject([{ toId: art.id }])
    expect(listRequests(db, art.id).incoming).toEqual([])
    // The one who declined asks later: she already wanted it, so they are friends at once.
    expect(askFriend(db, art.id, momList, mom.id)).toBe('friends')
    expect(areFriends(db, art.id, mom.id)).toBe(true)
    expect(requestRows(db)).toEqual([])
    expect(listNotices(db, mom.id)).toMatchObject([{ kind: 'friend_accepted', actor: 'Art' }])
  })

  it('makes friends of two people who ask each other, once, with nothing left over', () => {
    const { db, art, mom, kerst, momList } = setup()
    expect(askFriend(db, mom.id, kerst, art.id)).toBe('asked')
    expect(askFriend(db, art.id, momList, mom.id)).toBe('friends')
    expect(friendshipRows(db)).toHaveLength(1)
    expect(requestRows(db)).toEqual([])
    // The one who asked first is told; the one who asked second saw it happen.
    expect(listNotices(db, mom.id)).toMatchObject([{ kind: 'friend_accepted', actor: 'Art' }])
    expect(listNotices(db, art.id)).toEqual([])
    expect(askFriend(db, mom.id, kerst, art.id)).toBe('friends')
    expect(friendshipRows(db)).toHaveLength(1)
  })

  it('lets only the receiver answer and only the sender withdraw, and only while it waits', () => {
    const { db, art, lot, mom, kerst } = setup()
    askFriend(db, mom.id, kerst, art.id)
    const [request] = listRequests(db, art.id).incoming
    expect(codeOf(() => answerRequest(db, lot.id, request!.id, true))).toBe('not_found')
    expect(codeOf(() => answerRequest(db, mom.id, request!.id, true))).toBe('not_found')
    expect(codeOf(() => withdrawRequest(db, art.id, request!.id))).toBe('not_found')
    expect(codeOf(() => withdrawRequest(db, lot.id, request!.id))).toBe('not_found')
    expect(codeOf(() => answerRequest(db, art.id, 'no-such-request', true))).toBe('not_found')
    answerRequest(db, art.id, request!.id, false)
    // Declined is answered: a second answer finds nothing.
    expect(codeOf(() => answerRequest(db, art.id, request!.id, true))).toBe('not_found')
    expect(areFriends(db, art.id, mom.id)).toBe(false)
  })

  it('takes a waiting request back', () => {
    const { db, art, mom, kerst } = setup()
    askFriend(db, mom.id, kerst, art.id)
    const [request] = listRequests(db, mom.id).outgoing
    withdrawRequest(db, mom.id, request!.id)
    expect(requestRows(db)).toEqual([])
    expect(listRequests(db, art.id).incoming).toEqual([])
    // Withdrawn while waiting, she can ask again and it arrives.
    askFriend(db, mom.id, kerst, art.id)
    expect(listRequests(db, art.id).incoming).toHaveLength(1)
  })

  it('lists the newest request first', () => {
    const { db, art, lot, mom, kerst } = setup()
    askFriend(db, mom.id, kerst, art.id)
    later()
    askFriend(db, lot.id, kerst, art.id)
    expect(listRequests(db, art.id).incoming.map(row => row.from)).toEqual(['Lot', 'Mom'])
  })

  it(`refuses a request once the sender sees ${MAX_WAITING_REQUESTS} waiting, declined ones included`, () => {
    const { db, mom } = setup()
    const owners = Array.from({ length: MAX_WAITING_REQUESTS + 1 }, (_, n) => {
      const owner = addUser(db, `owner${n}`)
      return { owner, list: addList(db, owner.id) }
    })
    for (const { owner, list } of owners.slice(0, MAX_WAITING_REQUESTS)) askFriend(db, mom.id, list, owner.id)
    const last = owners.at(-1)!
    expect(codeOf(() => askFriend(db, mom.id, last.list, last.owner.id))).toBe('request_limit')
    // A decline frees no place: that would give it away.
    const first = owners[0]!
    answerRequest(db, first.owner.id, listRequests(db, first.owner.id).incoming[0]!.id, false)
    expect(codeOf(() => askFriend(db, mom.id, last.list, last.owner.id))).toBe('request_limit')
    // Taking one back does, whether it was waiting or declined.
    withdrawRequest(db, mom.id, listRequests(db, mom.id).outgoing.find(row => row.toId === first.owner.id)!.id)
    expect(askFriend(db, mom.id, last.list, last.owner.id)).toBe('asked')
  })

  it(`refuses a friendship when either side has ${MAX_FRIENDS} friends`, () => {
    const { db, art, mom, kerst } = setup()
    const now = new Date()
    for (let n = 0; n < MAX_FRIENDS; n++) {
      const other = addUser(db, `friend${n}`)
      db.insert(friendships).values({ userLow: Math.min(art.id, other.id), userHigh: Math.max(art.id, other.id), createdAt: now }).run()
    }
    askFriend(db, mom.id, kerst, art.id)
    const [request] = listRequests(db, art.id).incoming
    expect(codeOf(() => answerRequest(db, art.id, request!.id, true))).toBe('friend_limit')
    expect(areFriends(db, art.id, mom.id)).toBe(false)
    expect(listRequests(db, art.id).incoming).toHaveLength(1)
  })

  it('can still be answered when its list is gone, moved or no longer the receiver\'s', () => {
    const { db, art, lot, mom, kerst } = setup()
    const samen = addList(db, art.id, 'Samen')
    addOwner(db, samen, lot.id)
    askFriend(db, mom.id, kerst, art.id)
    askFriend(db, mom.id, samen, lot.id)
    relinkList(db, art.id, samen)
    deleteList(db, art.id, kerst)
    // The deleted list is no longer named; the moved one still is.
    expect(listRequests(db, art.id).incoming).toMatchObject([{ fromId: mom.id, via: null }])
    expect(listRequests(db, lot.id).incoming).toMatchObject([{ fromId: mom.id, via: 'Samen' }])
    expect(answerRequest(db, art.id, listRequests(db, art.id).incoming[0]!.id, true)).toEqual({ friendId: mom.id })
    expect(answerRequest(db, lot.id, listRequests(db, lot.id).incoming[0]!.id, false)).toBeNull()
  })

  it('counts the requests the receiver has not seen yet', () => {
    const { db, art, lot, mom, kerst } = setup()
    expect(countFreshRequests(db, art.id)).toBe(0)
    askFriend(db, mom.id, kerst, art.id)
    askFriend(db, lot.id, kerst, art.id)
    expect(countFreshRequests(db, art.id)).toBe(2)
    expect(countFreshRequests(db, mom.id)).toBe(0)
    markRequestsSeen(db, art.id)
    expect(countFreshRequests(db, art.id)).toBe(0)
    expect(listRequests(db, art.id).incoming.map(row => row.fresh)).toEqual([false, false])
    // A declined one never counts.
    answerRequest(db, art.id, listRequests(db, art.id).incoming[0]!.id, false)
    expect(countFreshRequests(db, art.id)).toBe(0)
  })
})

describe('friends', () => {
  it('stop being friends in silence, from either side', () => {
    const { db, art, lot, mom, kerst } = setup()
    befriend(db, mom.id, kerst, art.id)
    const before = listNotices(db, art.id).length
    removeFriend(db, art.id, mom.id)
    expect(areFriends(db, art.id, mom.id)).toBe(false)
    expect(listNotices(db, mom.id).filter(notice => notice.kind !== 'friend_accepted')).toEqual([])
    expect(listNotices(db, art.id)).toHaveLength(before)
    expect(codeOf(() => removeFriend(db, art.id, mom.id))).toBe('not_friends')
    expect(codeOf(() => removeFriend(db, art.id, lot.id))).toBe('not_friends')
    // They can become friends again, by asking.
    befriend(db, art.id, addList(db, mom.id), mom.id)
    removeFriend(db, mom.id, art.id)
    expect(areFriends(db, art.id, mom.id)).toBe(false)
  })

  it('and their requests go with a deleted account', () => {
    const { db, art, lot, mom, kerst } = setup()
    befriend(db, mom.id, kerst, art.id)
    askFriend(db, lot.id, kerst, art.id)
    askFriend(db, art.id, addList(db, lot.id), lot.id)
    deleteUser(db, art.id)
    expect(friendshipRows(db)).toEqual([])
    expect(requestRows(db)).toEqual([])
    expect(listRequests(db, lot.id)).toEqual({ incoming: [], outgoing: [] })
  })

  it('never read what buyers did', () => {
    expect(readFileSync('server/domain/friends.ts', 'utf8')).not.toMatch(/purchases|notes/i)
  })
})
