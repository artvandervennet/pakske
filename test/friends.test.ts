import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { friendLinks, friendRequests, friendships, listFriends as shownRows, lists } from '../server/db/schema'
import {
  acceptFriendLink, answerRequest, areFriends, askFriend, countFreshRequests, FRIEND_LINK_DAYS, getFriendLink, hideShownList,
  isShownTo, listFriends, listFriendsForList, listRequests, listShownLists, makeFriendLink, markRequestsSeen, MAX_FRIENDS, ownersToBefriend,
  MAX_OPEN_FRIEND_LINKS, MAX_WAITING_REQUESTS, removeFriend, setShownLists, setShownTo, setShownToOne, withdrawRequest,
} from '../server/domain/friends'
import { LIST_TOKEN } from '../server/domain/tokens'
import { deleteList, leaveList, ownedListId, relinkList } from '../server/domain/lists'
import { listNotices } from '../server/domain/notices'
import { createUser, deleteUser } from '../server/domain/users'
import { listOpenedLists, listOthersLists, rememberList, takeOffPage } from '../server/domain/visits'
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
/** The address a list has now, by its title: after a new link the one a test started with is old. */
const currentToken = (db: ReturnType<typeof makeDb>, title: string) => db.select({ token: lists.token }).from(lists).where(eq(lists.title, title)).get()!.token
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

  it('gives a sender who takes a request back and asks again the same to see, declined or not', () => {
    // Two worlds that differ only in whether Art declined. In both, Mom then asks Lotte, takes
    // her request to Art back and asks him again. What she can see must be the same in both.
    const seen = [false, true].map((declined) => {
      const { db, art, lot, mom, kerst } = setup()
      askFriend(db, mom.id, kerst, art.id)
      const first = listRequests(db, mom.id).outgoing[0]!.id
      if (declined) answerRequest(db, art.id, listRequests(db, art.id).incoming[0]!.id, false)
      later()
      askFriend(db, mom.id, addList(db, lot.id), lot.id)
      later()
      withdrawRequest(db, mom.id, first)
      expect(listRequests(db, mom.id).outgoing.map(row => row.to)).toEqual(['Lot'])
      later()
      expect(askFriend(db, mom.id, kerst, art.id)).toBe('asked')
      const outgoing = listRequests(db, mom.id).outgoing
      return { order: outgoing.map(row => row.to), sameId: outgoing.some(row => row.id === first), reachedArt: listRequests(db, art.id).incoming.length }
    })
    expect(seen[0]).toMatchObject({ order: ['Art', 'Lot'], sameId: false })
    expect(seen[1]).toMatchObject({ order: ['Art', 'Lot'], sameId: false })
    // The one difference is on Art's side: a request he declined doesn't come back to him.
    expect(seen.map(world => world.reachedArt)).toEqual([1, 0])
  })

  it('does not count a declined request its sender took back as still wanting it', () => {
    const { db, art, mom, kerst, momList } = setup()
    askFriend(db, mom.id, kerst, art.id)
    const request = listRequests(db, art.id).incoming[0]!
    answerRequest(db, art.id, request.id, false)
    withdrawRequest(db, mom.id, request.id)
    // Art asks her after all. She took hers back, so this is a request like any other: hers to answer.
    expect(askFriend(db, art.id, momList, mom.id)).toBe('asked')
    expect(areFriends(db, art.id, mom.id)).toBe(false)
    expect(listNotices(db, mom.id)).toEqual([])
    expect(listRequests(db, mom.id)).toMatchObject({ incoming: [{ fromId: art.id, from: 'Art' }], outgoing: [] })
    expect(requestRows(db)).toHaveLength(1)
    expect(answerRequest(db, mom.id, listRequests(db, mom.id).incoming[0]!.id, true)).toEqual({ friendId: art.id })
    expect(areFriends(db, art.id, mom.id)).toBe(true)
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
    // A list the receiver no longer owns isn't named either: its title may have changed since,
    // and is no longer theirs to read.
    leaveList(db, lot.id, currentToken(db, 'Samen'))
    expect(listRequests(db, lot.id).incoming).toMatchObject([{ fromId: mom.id, via: null }])
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

describe('the owners of a list someone opened', () => {
  it('can each be asked, and say what has been asked already', () => {
    const { db, art, lot, mom, kerst } = setup()
    addOwner(db, kerst, lot.id)
    expect(ownersToBefriend(db, mom.id, kerst)).toEqual([
      { id: art.id, name: 'Art', state: 'none' },
      { id: lot.id, name: 'Lot', state: 'none' },
    ])
    askFriend(db, mom.id, kerst, art.id)
    befriend(db, mom.id, kerst, lot.id)
    expect(ownersToBefriend(db, mom.id, kerst).map(owner => owner.state)).toEqual(['asked', 'friends'])
    // A decline reads the same; a declined request she took back reads as not asked.
    const request = listRequests(db, art.id).incoming[0]!
    answerRequest(db, art.id, request.id, false)
    expect(ownersToBefriend(db, mom.id, kerst)[0]).toMatchObject({ state: 'asked' })
    withdrawRequest(db, mom.id, request.id)
    expect(ownersToBefriend(db, mom.id, kerst)[0]).toMatchObject({ state: 'none' })
  })

  it('are nobody for an owner of the list, on a deleted list, and under a token that matches none', () => {
    const { db, art, mom, kerst } = setup()
    expect(ownersToBefriend(db, art.id, kerst)).toEqual([])
    expect(ownersToBefriend(db, mom.id, 'no-such-list-token-000')).toEqual([])
    deleteList(db, art.id, kerst)
    expect(ownersToBefriend(db, mom.id, kerst)).toEqual([])
  })
})

describe('a friend link', () => {
  it('makes whoever opens it a friend of its maker, once', () => {
    const { db, art, lot, mom } = setup()
    const { token } = makeFriendLink(db, art.id)
    expect(token).toMatch(LIST_TOKEN)
    expect(getFriendLink(db, token, mom.id)).toEqual({ from: 'Art', state: 'open' })
    expect(acceptFriendLink(db, mom.id, token)).toEqual({ friendId: art.id })
    expect(areFriends(db, art.id, mom.id)).toBe(true)
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'friend_link_used', actor: 'Mom', actorId: mom.id, token: null }])
    expect(listNotices(db, mom.id)).toEqual([])
    // Spent: the next person finds it closed, and so does the one who used it.
    expect(getFriendLink(db, token, lot.id)).toEqual({ from: 'Art', state: 'closed' })
    expect(codeOf(() => acceptFriendLink(db, lot.id, token))).toBe('invite_closed')
    expect(areFriends(db, art.id, lot.id)).toBe(false)
  })

  it('is its maker\'s own to send, not to use', () => {
    const { db, art } = setup()
    const { token } = makeFriendLink(db, art.id)
    expect(getFriendLink(db, token, art.id)).toEqual({ from: 'Art', state: 'own' })
    expect(codeOf(() => acceptFriendLink(db, art.id, token))).toBe('forbidden')
    expect(friendshipRows(db)).toEqual([])
  })

  it('is nothing under a token that matches no link', () => {
    const { db, mom } = setup()
    expect(getFriendLink(db, 'no-such-link-token-0000', mom.id)).toBeUndefined()
    expect(codeOf(() => acceptFriendLink(db, mom.id, 'no-such-link-token-0000'))).toBe('not_found')
  })

  it(`stops working after ${FRIEND_LINK_DAYS} days`, () => {
    const { db, art, mom } = setup()
    const { token } = makeFriendLink(db, art.id)
    vi.setSystemTime(new Date(Date.now() + FRIEND_LINK_DAYS * 24 * 60 * 60 * 1000 - 1000))
    expect(getFriendLink(db, token, mom.id)).toMatchObject({ state: 'open' })
    vi.setSystemTime(new Date(Date.now() + 2000))
    expect(getFriendLink(db, token, mom.id)).toMatchObject({ state: 'closed' })
    expect(codeOf(() => acceptFriendLink(db, mom.id, token))).toBe('invite_closed')
  })

  it(`keeps ${MAX_OPEN_FRIEND_LINKS} open links at most: one more drops the oldest`, () => {
    const { db, art, mom } = setup()
    const made: string[] = []
    for (let n = 0; n <= MAX_OPEN_FRIEND_LINKS; n++) {
      made.push(makeFriendLink(db, art.id).token)
      later()
    }
    expect(db.select().from(friendLinks).all()).toHaveLength(MAX_OPEN_FRIEND_LINKS)
    expect(getFriendLink(db, made[0]!, mom.id)).toBeUndefined()
    expect(getFriendLink(db, made[1]!, mom.id)).toMatchObject({ state: 'open' })
    expect(getFriendLink(db, made.at(-1)!, mom.id)).toMatchObject({ state: 'open' })
  })

  it('stays open for someone else when a friend opens it', () => {
    const { db, art, lot, mom, kerst } = setup()
    befriend(db, mom.id, kerst, art.id)
    const { token } = makeFriendLink(db, art.id)
    expect(getFriendLink(db, token, mom.id)).toEqual({ from: 'Art', state: 'friends' })
    expect(codeOf(() => acceptFriendLink(db, mom.id, token))).toBe('forbidden')
    expect(acceptFriendLink(db, lot.id, token)).toEqual({ friendId: art.id })
  })

  it('answers a request that was waiting between the two', () => {
    const { db, art, mom, kerst } = setup()
    askFriend(db, mom.id, kerst, art.id)
    const { token } = makeFriendLink(db, art.id)
    acceptFriendLink(db, mom.id, token)
    expect(requestRows(db)).toEqual([])
    expect(listRequests(db, art.id).incoming).toEqual([])
  })

  it('goes with its maker\'s account', () => {
    const { db, art, mom } = setup()
    const { token } = makeFriendLink(db, art.id)
    deleteUser(db, art.id)
    expect(getFriendLink(db, token, mom.id)).toBeUndefined()
  })
})

describe('showing a list to a friend', () => {
  /** Art and Mom are friends, and so are Lotte and Mom. */
  function friends() {
    const world = setup()
    const { db, art, lot, mom, kerst } = world
    befriend(db, mom.id, kerst, art.id)
    befriend(db, mom.id, addList(db, lot.id, 'Lijst van lot'), lot.id)
    return world
  }
  const shownTo = (db: ReturnType<typeof makeDb>, userId: number) => listShownLists(db, userId).map(list => list.title)
  const shownRows_ = (db: ReturnType<typeof makeDb>) => db.select().from(shownRows).all().length
  const shownNotices = (db: ReturnType<typeof makeDb>, userId: number) => listNotices(db, userId).filter(notice => notice.kind === 'list_shown')

  it('switches one friend without touching another', () => {
    const { db, art, lot, mom, kerst } = friends()
    acceptFriendLink(db, lot.id, makeFriendLink(db, art.id).token)
    setShownToOne(db, art.id, kerst, mom.id, true)
    setShownToOne(db, art.id, kerst, lot.id, true)
    expect(shownTo(db, mom.id)).toEqual(['Kerst'])
    expect(shownTo(db, lot.id)).toEqual(['Kerst'])
    expect(shownNotices(db, mom.id)).toHaveLength(1)
    // On again changes nothing and tells nobody twice.
    setShownToOne(db, art.id, kerst, mom.id, true)
    expect(shownNotices(db, mom.id)).toHaveLength(1)
    setShownToOne(db, art.id, kerst, mom.id, false)
    expect(shownTo(db, mom.id)).toEqual([])
    expect(shownNotices(db, mom.id)).toEqual([])
    expect(shownTo(db, lot.id)).toEqual(['Kerst'])
    expect(listFriendsForList(db, art.id, kerst)).toMatchObject([{ id: lot.id, shown: true }, { id: mom.id, shown: false }])
  })

  it('refuses to switch someone who is no friend, a list that isn\'t theirs, and leaves a co-owner alone', () => {
    const { db, art, lot, mom, kerst, momList } = friends()
    expect(codeOf(() => setShownToOne(db, art.id, kerst, lot.id, true))).toBe('not_friends')
    expect(codeOf(() => setShownToOne(db, art.id, momList, mom.id, true))).toBe('not_found')
    addOwner(db, kerst, mom.id)
    setShownToOne(db, art.id, kerst, mom.id, true)
    expect(shownRows_(db)).toBe(0)
  })

  it('shows nothing just by being friends', () => {
    const { db, art, mom } = friends()
    expect(listShownLists(db, mom.id)).toEqual([])
    expect(listShownLists(db, art.id)).toEqual([])
    expect(listFriends(db, art.id)).toMatchObject([{ id: mom.id, name: 'Mom', shows: [{ title: 'Kerst', shown: false }], sees: [] }])
  })

  it('puts a ticked list on the friend\'s page and tells them, and takes both away again without a word', () => {
    const { db, art, mom, kerst, momList } = friends()
    setShownLists(db, art.id, mom.id, [kerst])
    expect(listShownLists(db, mom.id)).toEqual([{ token: kerst, title: 'Kerst', owners: ['Art'], by: ['Art'] }])
    expect(shownNotices(db, mom.id)).toMatchObject([{ actor: 'Art', title: 'Kerst', token: kerst }])
    expect(listFriends(db, art.id)).toMatchObject([{ id: mom.id, shows: [{ token: kerst, title: 'Kerst', shown: true }], sees: [] }])
    expect(listFriends(db, mom.id).find(friend => friend.id === art.id)).toMatchObject({
      name: 'Art',
      shows: [{ token: momList, shown: false }],
      sees: [{ token: kerst, title: 'Kerst' }],
    })
    expect(isShownTo(db, mom.id, ownedListId(db, art.id, kerst))).toBe(true)
    // Showing is one way: Art sees nothing of Mom's.
    expect(listShownLists(db, art.id)).toEqual([])
    // Ticking it again changes nothing and says nothing more.
    setShownLists(db, art.id, mom.id, [kerst])
    expect(shownNotices(db, mom.id)).toHaveLength(1)

    const before = listNotices(db, art.id).length
    setShownLists(db, art.id, mom.id, [])
    expect(listShownLists(db, mom.id)).toEqual([])
    expect(shownNotices(db, mom.id)).toEqual([])
    expect(listNotices(db, art.id)).toHaveLength(before)
    expect(isShownTo(db, mom.id, ownedListId(db, art.id, kerst))).toBe(false)
  })

  it('ticks friends from the list as well', () => {
    const { db, art, lot, mom, kerst } = friends()
    befriend(db, lot.id, kerst, art.id)
    expect(listFriendsForList(db, art.id, kerst)).toMatchObject([
      { id: lot.id, name: 'Lot', shown: false },
      { id: mom.id, name: 'Mom', shown: false },
    ])
    setShownTo(db, art.id, kerst, [mom.id, lot.id])
    expect(shownTo(db, mom.id)).toEqual(['Kerst'])
    expect(shownTo(db, lot.id)).toEqual(['Kerst'])
    setShownTo(db, art.id, kerst, [lot.id])
    expect(shownTo(db, mom.id)).toEqual([])
    expect(listFriendsForList(db, art.id, kerst)).toMatchObject([
      { id: lot.id, name: 'Lot', shown: true },
      { id: mom.id, name: 'Mom', shown: false },
    ])
  })

  it('is only for a list of your own and a friend of your own', () => {
    const { db, art, lot, mom, kerst, momList } = friends()
    // Art and Lotte are no friends; Mom's list isn't Art's.
    expect(codeOf(() => setShownLists(db, art.id, lot.id, [kerst]))).toBe('not_friends')
    expect(codeOf(() => setShownTo(db, art.id, kerst, [lot.id]))).toBe('not_friends')
    expect(codeOf(() => setShownLists(db, art.id, mom.id, [momList]))).toBe('not_found')
    expect(codeOf(() => setShownTo(db, art.id, momList, [mom.id]))).toBe('not_found')
    expect(codeOf(() => listFriendsForList(db, art.id, momList))).toBe('not_found')
    expect(codeOf(() => setShownLists(db, art.id, mom.id, [kerst, 'no-such-list-token-000']))).toBe('not_found')
    expect(db.select().from(shownRows).all()).toEqual([])
  })

  it('keeps each owner\'s ticks apart on a joint list', () => {
    const { db, art, lot, mom, kerst } = friends()
    addOwner(db, kerst, lot.id)
    setShownTo(db, art.id, kerst, [mom.id])
    later()
    setShownTo(db, lot.id, kerst, [mom.id])
    expect(listShownLists(db, mom.id)).toMatchObject([{ title: 'Kerst', owners: ['Art', 'Lot'], by: ['Art', 'Lot'] }])
    // Each sees only their own friends there, and unticks only their own tick.
    expect(listFriendsForList(db, art.id, kerst)).toMatchObject([{ id: mom.id, name: 'Mom', shown: true }])
    setShownTo(db, art.id, kerst, [])
    expect(listShownLists(db, mom.id)).toMatchObject([{ title: 'Kerst', by: ['Lot'] }])
    expect(listFriendsForList(db, lot.id, kerst)).toMatchObject([{ id: mom.id, name: 'Mom', shown: true }])
    setShownTo(db, lot.id, kerst, [])
    expect(listShownLists(db, mom.id)).toEqual([])
  })

  it('never lists a list under a friend who owns it', () => {
    const { db, art, lot, mom, kerst } = friends()
    befriend(db, lot.id, kerst, art.id)
    setShownTo(db, art.id, kerst, [mom.id])
    addOwner(db, kerst, mom.id)
    expect(listShownLists(db, mom.id)).toEqual([])
    // There is no switch for her on that list: it would do nothing. The other friend keeps theirs.
    expect(listFriendsForList(db, art.id, kerst)).toMatchObject([{ id: lot.id, name: 'Lot', shown: false }])
    expect(listFriends(db, art.id).find(friend => friend.id === mom.id)!.shows.map(list => list.title)).toEqual([])
    expect(listFriends(db, art.id).find(friend => friend.id === lot.id)!.shows.map(list => list.title)).toEqual(['Kerst'])
    // Saving the switches that are offered leaves hers as it was.
    setShownTo(db, art.id, kerst, [lot.id])
    setShownLists(db, art.id, mom.id, [])
    // Ticking an owner does nothing: the list is theirs already.
    setShownTo(db, art.id, kerst, [mom.id])
    // She leaves; Art still ticks it for her, so it is shown again.
    leaveList(db, mom.id, kerst)
    expect(shownTo(db, mom.id)).toEqual(['Kerst'])
    setShownTo(db, art.id, kerst, [])
    expect(shownTo(db, mom.id)).toEqual([])
  })

  it('stops when the owner who showed it leaves the list, and when the list is deleted', () => {
    const { db, art, lot, mom, kerst } = friends()
    addOwner(db, kerst, lot.id)
    setShownTo(db, lot.id, kerst, [mom.id])
    expect(shownTo(db, mom.id)).toEqual(['Kerst'])
    leaveList(db, lot.id, kerst)
    expect(shownTo(db, mom.id)).toEqual([])
    expect(db.select().from(shownRows).all()).toEqual([])
    // What she was told about it goes too: it would point at nothing.
    expect(shownNotices(db, mom.id)).toEqual([])
    setShownTo(db, art.id, kerst, [mom.id])
    expect(shownNotices(db, mom.id)).toHaveLength(1)
    deleteList(db, art.id, kerst)
    expect(shownTo(db, mom.id)).toEqual([])
    expect(db.select().from(shownRows).all()).toEqual([])
    expect(shownNotices(db, mom.id)).toEqual([])
  })

  it('follows a list to its new link', () => {
    const { db, art, mom, kerst } = friends()
    setShownTo(db, art.id, kerst, [mom.id])
    const { token } = relinkList(db, art.id, kerst)
    expect(listShownLists(db, mom.id)).toMatchObject([{ token, title: 'Kerst' }])
    expect(shownNotices(db, mom.id)).toMatchObject([{ token }])
  })

  it('lets the friend take a shown list off their own page, without the owner knowing', () => {
    const { db, art, mom, kerst } = friends()
    setShownTo(db, art.id, kerst, [mom.id])
    const before = listNotices(db, art.id).length
    hideShownList(db, mom.id, kerst)
    expect(listShownLists(db, mom.id)).toEqual([])
    expect(listFriends(db, mom.id).find(friend => friend.id === art.id)!.sees).toEqual([])
    expect(listFriendsForList(db, art.id, kerst)).toMatchObject([{ id: mom.id, name: 'Mom', shown: true }])
    expect(listNotices(db, art.id)).toHaveLength(before)
    expect(codeOf(() => hideShownList(db, mom.id, kerst))).toBe('not_found')
    expect(codeOf(() => hideShownList(db, art.id, kerst))).toBe('not_found')
    // Ticking it again by itself changes nothing; unticking and ticking shows it anew.
    setShownTo(db, art.id, kerst, [mom.id])
    expect(listShownLists(db, mom.id)).toEqual([])
    setShownTo(db, art.id, kerst, [])
    setShownTo(db, art.id, kerst, [mom.id])
    expect(shownTo(db, mom.id)).toEqual(['Kerst'])
  })

  it('tells two friends with the same name apart', () => {
    const { db, art, mom, kerst } = friends()
    const other = createUser(db, { email: 'mom2@example.test', displayName: 'Mom', passwordHash: 'not-a-real-hash' })
    befriend(db, other.id, kerst, art.id)
    expect(listFriendsForList(db, art.id, kerst)).toMatchObject([
      { id: mom.id, name: 'Mom', shown: false },
      { id: other.id, name: 'Mom', shown: false },
    ])
    setShownTo(db, art.id, kerst, [other.id])
    expect(shownTo(db, other.id)).toEqual(['Kerst'])
    expect(shownTo(db, mom.id)).toEqual([])
    expect(listFriends(db, art.id).map(friend => [friend.id, friend.shows.find(list => list.token === kerst)!.shown])).toEqual([[mom.id, false], [other.id, true]])
  })

  it('lists the newest tick first', () => {
    const { db, art, lot, mom, kerst } = friends()
    setShownTo(db, art.id, kerst, [mom.id])
    later()
    const lotList = listFriends(db, lot.id)[0]!.shows[0]!.token
    setShownLists(db, lot.id, mom.id, [lotList])
    expect(shownTo(db, mom.id)).toEqual(['Lijst van lot', 'Kerst'])
  })

  it('is not remembered as visited when it is opened while shown: no link was needed', () => {
    const { db, art, mom, kerst } = friends()
    setShownTo(db, art.id, kerst, [mom.id])
    rememberList(db, mom.id, kerst)
    setShownTo(db, art.id, kerst, [])
    expect(listOpenedLists(db, mom.id)).toEqual([])
    // Opened by its link when it isn't shown, it is a visited list like any other.
    rememberList(db, mom.id, kerst)
    expect(listOpenedLists(db, mom.id).map(list => list.title)).toEqual(['Kerst'])
  })

  it('is not also a visited list while it is shown', () => {
    const { db, art, mom, kerst } = friends()
    rememberList(db, mom.id, kerst)
    expect(listOpenedLists(db, mom.id).map(list => list.title)).toEqual(['Kerst'])
    setShownTo(db, art.id, kerst, [mom.id])
    expect(listOpenedLists(db, mom.id)).toEqual([])
    // She had opened its link herself before, so it is a visited list again once it isn't shown.
    setShownTo(db, art.id, kerst, [])
    expect(listOpenedLists(db, mom.id).map(list => list.title)).toEqual(['Kerst'])
  })

  it('stands in one row of other people\'s lists with the ones opened by a link, and never twice', () => {
    const { db, art, lot, mom, kerst } = friends()
    const lotList = listFriends(db, lot.id)[0]!.shows[0]!.token
    // Mom opened Lotte's list by its link; Art's she opened too, and then he switched it on for her.
    rememberList(db, mom.id, lotList)
    rememberList(db, mom.id, kerst)
    setShownTo(db, art.id, kerst, [mom.id])
    expect(listOthersLists(db, mom.id)).toEqual([
      { token: kerst, title: 'Kerst', owners: ['Art'], deleted: false },
      { token: lotList, title: 'Lijst van lot', owners: ['Lot'], deleted: false },
    ])
    // Nothing of her own, and nothing for someone who was shown nothing and opened nothing.
    expect(listOthersLists(db, art.id)).toEqual([])
  })

  it('leaves the page altogether when taken off, also when it had been opened by its link before', () => {
    const { db, art, lot, mom, kerst } = friends()
    const lotList = listFriends(db, lot.id)[0]!.shows[0]!.token
    rememberList(db, mom.id, kerst)
    rememberList(db, mom.id, lotList)
    setShownTo(db, art.id, kerst, [mom.id])
    takeOffPage(db, mom.id, kerst)
    expect(listOthersLists(db, mom.id).map(list => list.title)).toEqual(['Lijst van lot'])
    // Art's switch is as it was, and he isn't told.
    expect(listFriendsForList(db, art.id, kerst)).toMatchObject([{ id: mom.id, name: 'Mom', shown: true }])
    // A list that was only opened goes the same way; one that isn't on the page is no error.
    takeOffPage(db, mom.id, lotList)
    takeOffPage(db, mom.id, lotList)
    expect(listOthersLists(db, mom.id)).toEqual([])
    // Opening its link again puts it back, like any list.
    rememberList(db, mom.id, kerst)
    expect(listOthersLists(db, mom.id).map(list => list.title)).toEqual(['Kerst'])
  })

  it('ends with the friendship, and nothing comes back when they are friends again', () => {
    const { db, art, mom, kerst, momList } = friends()
    setShownTo(db, art.id, kerst, [mom.id])
    setShownTo(db, mom.id, momList, [art.id])
    removeFriend(db, mom.id, art.id)
    expect(listShownLists(db, mom.id)).toEqual([])
    expect(listShownLists(db, art.id)).toEqual([])
    expect(shownNotices(db, mom.id)).toEqual([])
    expect(shownNotices(db, art.id)).toEqual([])
    expect(db.select().from(shownRows).all()).toEqual([])
    befriend(db, art.id, momList, mom.id)
    expect(listShownLists(db, mom.id)).toEqual([])
    expect(listShownLists(db, art.id)).toEqual([])
    expect(listFriends(db, art.id).find(friend => friend.id === mom.id)).toMatchObject({ shows: [{ title: 'Kerst', shown: false }], sees: [] })
  })

  it('goes with a deleted account, on either side', () => {
    const { db, art, lot, mom, kerst } = friends()
    const lotList = listFriends(db, lot.id)[0]!.shows[0]!.token
    setShownTo(db, art.id, kerst, [mom.id])
    setShownLists(db, lot.id, mom.id, [lotList])
    // The owner goes: the list stays at its link, nobody's, and is shown to no friend.
    deleteUser(db, art.id)
    expect(shownTo(db, mom.id)).toEqual(['Lijst van lot'])
    expect(listFriends(db, mom.id).map(friend => friend.name)).toEqual(['Lot'])
    // The friend goes: the owner's page has no trace of her.
    deleteUser(db, mom.id)
    expect(listFriends(db, lot.id)).toEqual([])
    expect(db.select().from(shownRows).all()).toEqual([])
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
