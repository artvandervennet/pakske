import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import type { FriendLinkView, FriendView, RequestsView } from '../../shared/schemas/friends'
import type { ShownList } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { friendLinks, friendRequests, friendships, listFriends as shown, listOwners, lists, notices, users } from '../db/schema'
import { DomainError } from './errors'
import { ownedListId, ownersOfList } from './lists'
import { addNotice } from './notices'
import { newListToken } from './tokens'

// Friends: two people who chose each other once, so they can share without sending links.
// There is no directory here. Someone can only be asked from a list of theirs that the asker can
// open, and nobody ever gets to see who someone else's friends are.
//
// Being friends changes nothing on a list: a friend who opens one is a buyer like anyone who has
// its link. Nothing in this file looks at what buyers did, and a test keeps it that way.

export const MAX_FRIENDS = 100
/** How many requests a person can have out at once, counting every one they still see. */
export const MAX_WAITING_REQUESTS = 20
/** Friend links a person can have open at once; making one more drops the oldest. */
export const MAX_OPEN_FRIEND_LINKS = 10
/** How long a friend link works. It can be passed on, so it must end by itself. */
export const FRIEND_LINK_DAYS = 30

const pairOf = (a: number, b: number) => ({ userLow: Math.min(a, b), userHigh: Math.max(a, b) })
const isPair = (a: number, b: number) => and(eq(friendships.userLow, Math.min(a, b)), eq(friendships.userHigh, Math.max(a, b)))
const between = (from: number, to: number) => and(eq(friendRequests.fromUser, from), eq(friendRequests.toUser, to))

export function areFriends(db: Db, a: number, b: number): boolean {
  return db.select({ userLow: friendships.userLow }).from(friendships).where(isPair(a, b)).get() !== undefined
}

function friendCount(db: Db, userId: number): number {
  return db.select({ n: count() }).from(friendships)
    .where(or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId))).get()!.n
}

/**
 * Makes two people friends, and with that answers whatever either had asked of the other. Runs
 * in the caller's transaction.
 */
function makeFriends(db: Db, a: number, b: number): void {
  if (friendCount(db, a) >= MAX_FRIENDS || friendCount(db, b) >= MAX_FRIENDS) throw new DomainError('friend_limit')
  db.insert(friendships).values(pairOf(a, b)).onConflictDoNothing().run()
  db.delete(friendRequests).where(or(between(a, b), between(b, a))).run()
}

/** The requests a sender still sees on their page: waiting ones, and declined ones they didn't take away. */
function waitingFor(db: Db, userId: number): number {
  return db.select({ n: count() }).from(friendRequests)
    .where(and(eq(friendRequests.fromUser, userId), eq(friendRequests.hidden, false))).get()!.n
}

/**
 * Asks the owner of a list to be friends. The list is how the asker knows them: it must be live
 * and theirs, or the answer is "not found". Answers `friends` when that is what they are now.
 *
 * A request the asker already has out to this person, whatever became of it, is all there will
 * be: asking again reaches nobody, so a decline stays silent and can't be pushed past. A declined
 * one the asker had taken back comes back on their page as a request made now, with a new id and
 * a new place in the order, exactly as a waiting one they took back and sent again would.
 *
 * A request the other way that its sender still stands by, also one this asker declined before,
 * means both want it: they are friends at once, and the one who asked first is told. One its
 * sender took back is gone: this request then waits for their answer like any other.
 */
export function askFriend(db: Db, userId: number, listToken: string, ownerId: number): 'asked' | 'friends' {
  return db.transaction((tx) => {
    const list = tx.select({ id: lists.id }).from(lists)
      .innerJoin(listOwners, eq(listOwners.listId, lists.id))
      .where(and(eq(lists.token, listToken), eq(listOwners.userId, ownerId), isNull(lists.deletedAt)))
      .get()
    if (!list) throw new DomainError('not_found')
    if (ownerId === userId) throw new DomainError('forbidden')
    if (areFriends(tx, userId, ownerId)) return 'friends'

    const mine = tx.select().from(friendRequests).where(between(userId, ownerId)).get()
    if (mine) {
      if (mine.hidden) {
        if (waitingFor(tx, userId) >= MAX_WAITING_REQUESTS) throw new DomainError('request_limit')
        tx.update(friendRequests)
          .set({ id: crypto.randomUUID(), createdAt: new Date(), listId: list.id, hidden: false })
          .where(eq(friendRequests.id, mine.id)).run()
      }
      return 'asked'
    }

    const theirs = tx.select().from(friendRequests).where(between(ownerId, userId)).get()
    if (theirs && !theirs.hidden) {
      makeFriends(tx, userId, ownerId)
      addNotice(tx, { userId: ownerId, kind: 'friend_accepted', actorId: userId, title: '' })
      return 'friends'
    }
    if (theirs) tx.delete(friendRequests).where(eq(friendRequests.id, theirs.id)).run()

    if (waitingFor(tx, userId) >= MAX_WAITING_REQUESTS) throw new DomainError('request_limit')
    tx.insert(friendRequests).values({ fromUser: userId, toUser: ownerId, listId: list.id }).run()
    return 'asked'
  }, { behavior: 'immediate' })
}

/**
 * The owners of a list as someone who opened it may befriend them: each with whether this person
 * asked already (`asked`, also after a decline, which they must not notice) or is their friend.
 * Nobody for an owner of the list, for a list that is gone, and for a token that matches none.
 */
export function ownersToBefriend(db: Db, viewerId: number, listToken: string): { id: number, name: string, state: 'none' | 'asked' | 'friends' }[] {
  const list = db.select({ id: lists.id }).from(lists).where(and(eq(lists.token, listToken), isNull(lists.deletedAt))).get()
  if (!list) return []
  const owners = ownersOfList(db, list.id)
  if (owners.some(owner => owner.userId === viewerId)) return []
  const asked = new Set(db.select({ toUser: friendRequests.toUser }).from(friendRequests)
    .where(and(eq(friendRequests.fromUser, viewerId), eq(friendRequests.hidden, false))).all().map(row => row.toUser))
  return owners.map(owner => ({
    id: owner.userId,
    name: owner.name,
    state: areFriends(db, viewerId, owner.userId) ? 'friends' : asked.has(owner.userId) ? 'asked' : 'none',
  }))
}

/**
 * The receiver's answer to a waiting request. Accepting makes them friends, tells the sender and
 * answers who the new friend is. Declining tells nobody: the request stays, as a declined one
 * only the receiver's side can tell from a waiting one. Anyone else, or a request that is
 * answered already, gets "not found".
 */
export function answerRequest(db: Db, userId: number, requestId: string, accept: boolean): { friendId: number } | null {
  return db.transaction((tx) => {
    const request = tx.select().from(friendRequests)
      .where(and(eq(friendRequests.id, requestId), eq(friendRequests.toUser, userId), eq(friendRequests.status, 'pending')))
      .get()
    if (!request) throw new DomainError('not_found')
    if (!accept) {
      tx.update(friendRequests).set({ status: 'declined' }).where(eq(friendRequests.id, request.id)).run()
      return null
    }
    makeFriends(tx, userId, request.fromUser)
    addNotice(tx, { userId: request.fromUser, kind: 'friend_accepted', actorId: userId, title: '' })
    return { friendId: request.fromUser }
  }, { behavior: 'immediate' })
}

/**
 * The sender takes a request back. A waiting one is gone. A declined one only leaves the
 * sender's page: it stays, so asking again still reaches nobody.
 */
export function withdrawRequest(db: Db, userId: number, requestId: string): void {
  db.transaction((tx) => {
    const request = tx.select().from(friendRequests)
      .where(and(eq(friendRequests.id, requestId), eq(friendRequests.fromUser, userId), eq(friendRequests.hidden, false)))
      .get()
    if (!request) throw new DomainError('not_found')
    if (request.status === 'pending') tx.delete(friendRequests).where(eq(friendRequests.id, request.id)).run()
    else tx.update(friendRequests).set({ hidden: true }).where(eq(friendRequests.id, request.id)).run()
  }, { behavior: 'immediate' })
}

export function listRequests(db: Db, userId: number): RequestsView {
  const newestFirst = [desc(friendRequests.createdAt), desc(sql`${friendRequests}.rowid`)]
  // The list a request came from is named while it exists and is still the receiver's: a list
  // they left may have another title by now, which is no longer theirs to read.
  const incoming = db.select({ request: friendRequests, from: users.displayName, title: lists.title, deletedAt: lists.deletedAt, owner: listOwners.userId })
    .from(friendRequests)
    .innerJoin(users, eq(users.id, friendRequests.fromUser))
    .leftJoin(lists, eq(lists.id, friendRequests.listId))
    .leftJoin(listOwners, and(eq(listOwners.listId, friendRequests.listId), eq(listOwners.userId, friendRequests.toUser)))
    .where(and(eq(friendRequests.toUser, userId), eq(friendRequests.status, 'pending')))
    .orderBy(...newestFirst)
    .all()
  const outgoing = db.select({ id: friendRequests.id, toId: friendRequests.toUser, to: users.displayName })
    .from(friendRequests)
    .innerJoin(users, eq(users.id, friendRequests.toUser))
    .where(and(eq(friendRequests.fromUser, userId), eq(friendRequests.hidden, false)))
    .orderBy(...newestFirst)
    .all()
  return {
    incoming: incoming.map(({ request, from, title, deletedAt, owner }) => ({
      id: request.id,
      fromId: request.fromUser,
      from,
      via: title !== null && deletedAt === null && owner !== null ? title : null,
      fresh: request.seenAt === null,
    })),
    outgoing,
  }
}

const freshFor = (userId: number) =>
  and(eq(friendRequests.toUser, userId), eq(friendRequests.status, 'pending'), isNull(friendRequests.seenAt))

/** How many waiting requests the person hasn't seen yet, for the mark in the header. */
export function countFreshRequests(db: Db, userId: number): number {
  return db.select({ n: count() }).from(friendRequests).where(freshFor(userId)).get()!.n
}

export function markRequestsSeen(db: Db, userId: number): void {
  db.update(friendRequests).set({ seenAt: new Date() }).where(freshFor(userId)).run()
}

/**
 * Makes a link to send to one person: whoever opens it while logged in, and says yes, is the
 * maker's friend. Making it is the maker's yes, so nothing waits for an answer afterwards.
 */
export function makeFriendLink(db: Db, userId: number): { token: string } {
  return db.transaction((tx) => {
    const now = new Date()
    // Links nobody used pile up when people make one and don't send it, so the oldest goes.
    const open = tx.select({ id: friendLinks.id }).from(friendLinks)
      .where(and(eq(friendLinks.createdBy, userId), isNull(friendLinks.usedAt), gt(friendLinks.expiresAt, now)))
      .orderBy(asc(friendLinks.id))
      .all()
    const dropping = open.slice(0, Math.max(0, open.length - (MAX_OPEN_FRIEND_LINKS - 1)))
    if (dropping.length > 0) tx.delete(friendLinks).where(inArray(friendLinks.id, dropping.map(row => row.id))).run()
    const token = newListToken()
    tx.insert(friendLinks).values({ token, createdBy: userId, expiresAt: new Date(now.getTime() + FRIEND_LINK_DAYS * 24 * 60 * 60 * 1000) }).run()
    return { token }
  }, { behavior: 'immediate' })
}

function findFriendLink(db: Db, token: string, viewerId: number) {
  const row = db.select({ link: friendLinks, from: users.displayName }).from(friendLinks)
    .innerJoin(users, eq(users.id, friendLinks.createdBy))
    .where(eq(friendLinks.token, token))
    .get()
  if (!row) return undefined
  const { link, from } = row
  let state: FriendLinkView['state'] = 'open'
  if (link.usedAt !== null || link.expiresAt.getTime() <= Date.now()) state = 'closed'
  else if (link.createdBy === viewerId) state = 'own'
  else if (areFriends(db, link.createdBy, viewerId)) state = 'friends'
  return { link, from, state }
}

/** What a friend link is to the person who opened it, or undefined for a token that matches none. */
export function getFriendLink(db: Db, token: string, viewerId: number): FriendLinkView | undefined {
  const found = findFriendLink(db, token, viewerId)
  return found && { from: found.from, state: found.state }
}

/**
 * Uses a friend link: the person and its maker are friends, the link is spent, and the maker is
 * told. A link opened by someone who is a friend already stays for someone else.
 */
export function acceptFriendLink(db: Db, userId: number, token: string): { friendId: number } {
  return db.transaction((tx) => {
    const found = findFriendLink(tx, token, userId)
    if (!found) throw new DomainError('not_found')
    if (found.state === 'own' || found.state === 'friends') throw new DomainError('forbidden')
    if (found.state !== 'open') throw new DomainError('invite_closed')
    const maker = found.link.createdBy
    makeFriends(tx, userId, maker)
    tx.update(friendLinks).set({ usedAt: new Date() }).where(eq(friendLinks.id, found.link.id)).run()
    addNotice(tx, { userId: maker, kind: 'friend_link_used', actorId: userId, title: '' })
    return { friendId: maker }
  }, { behavior: 'immediate' })
}

// ── Showing lists ──────────────────────────────────────────────────────────
// A friend finds a list on their own Lists page when one of its owners ticked it for them. That
// is all a tick does: it is no key, the list's link opens it for anyone.

/** The person's friends, by name; two with the same name by who became an account first. */
function friendsOf(db: Db, userId: number): { id: number, name: string }[] {
  const pairs = db.select().from(friendships)
    .where(or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId))).all()
  const ids = pairs.map(pair => (pair.userLow === userId ? pair.userHigh : pair.userLow))
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.displayName }).from(users)
    .where(inArray(users.id, ids))
    .orderBy(asc(users.displayName), asc(users.id))
    .all()
}

/** The person's live lists, oldest first. */
function ownLists(db: Db, userId: number): { id: number, token: string, title: string }[] {
  return db.select({ id: lists.id, token: lists.token, title: lists.title }).from(lists)
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(and(eq(listOwners.userId, userId), isNull(lists.deletedAt)))
    .orderBy(asc(lists.id))
    .all()
}

const tickOf = (listId: number, friendId: number, ownerId: number) =>
  and(eq(shown.listId, listId), eq(shown.userId, friendId), eq(shown.shownBy, ownerId))
const toldOf = (listId: number, friendId: number, ownerId: number) =>
  and(eq(notices.kind, 'list_shown'), eq(notices.listId, listId), eq(notices.userId, friendId), eq(notices.actorId, ownerId))

/**
 * Sets one owner's tick of one list for one friend. A new tick tells the friend; taking one away
 * takes that notice along and tells nobody. A friend who owns the list is not ticked: it is on
 * their own lists already. Runs in the caller's transaction.
 */
function tick(db: Db, ownerId: number, list: { id: number, title: string }, friendId: number, on: boolean): void {
  const has = db.select({ listId: shown.listId }).from(shown).where(tickOf(list.id, friendId, ownerId)).get() !== undefined
  if (on && !has) {
    const theirs = db.select({ userId: listOwners.userId }).from(listOwners)
      .where(and(eq(listOwners.listId, list.id), eq(listOwners.userId, friendId))).get() !== undefined
    if (theirs) return
    db.insert(shown).values({ listId: list.id, userId: friendId, shownBy: ownerId }).run()
    addNotice(db, { userId: friendId, kind: 'list_shown', actorId: ownerId, title: list.title, listId: list.id })
  }
  if (!on && has) {
    db.delete(shown).where(tickOf(list.id, friendId, ownerId)).run()
    db.delete(notices).where(toldOf(list.id, friendId, ownerId)).run()
  }
}

/** The ids of the lists a person owns, deleted ones included. */
function listsOwnedBy(db: Db, userId: number): Set<number> {
  return new Set(db.select({ listId: listOwners.listId }).from(listOwners).where(eq(listOwners.userId, userId)).all().map(row => row.listId))
}

/**
 * Which of the person's own lists one friend finds: exactly these. A list the friend owns too
 * has no switch (it is theirs already) and is left as it is.
 */
export function setShownLists(db: Db, ownerId: number, friendId: number, listTokens: string[]): void {
  db.transaction((tx) => {
    if (!areFriends(tx, ownerId, friendId)) throw new DomainError('not_friends')
    const chosen = new Set(listTokens.map(token => ownedListId(tx, ownerId, token)))
    const theirs = listsOwnedBy(tx, friendId)
    for (const list of ownLists(tx, ownerId)) {
      if (!theirs.has(list.id)) tick(tx, ownerId, list, friendId, chosen.has(list.id))
    }
  }, { behavior: 'immediate' })
}

/**
 * The person's friends who can be shown this list of the person's own, each with whether they
 * are. A friend who owns the list too isn't among them: it is on their own lists already.
 */
export function listFriendsForList(db: Db, ownerId: number, listToken: string): { id: number, name: string, shown: boolean }[] {
  const listId = ownedListId(db, ownerId, listToken)
  const owners = new Set(ownersOfList(db, listId).map(owner => owner.userId))
  const ticked = new Set(db.select({ userId: shown.userId }).from(shown)
    .where(and(eq(shown.listId, listId), eq(shown.shownBy, ownerId))).all().map(row => row.userId))
  return friendsOf(db, ownerId)
    .filter(friend => !owners.has(friend.id))
    .map(friend => ({ ...friend, shown: ticked.has(friend.id) }))
}

/**
 * Which of the person's friends find this list of the person's own: exactly these. A friend who
 * owns the list too has no switch and is left as they are.
 */
export function setShownTo(db: Db, ownerId: number, listToken: string, friendIds: number[]): void {
  db.transaction((tx) => {
    const listId = ownedListId(tx, ownerId, listToken)
    const list = tx.select({ id: lists.id, title: lists.title }).from(lists).where(eq(lists.id, listId)).get()!
    const owners = new Set(ownersOfList(tx, listId).map(owner => owner.userId))
    const friends = friendsOf(tx, ownerId)
    const chosen = new Set(friendIds)
    if ([...chosen].some(id => !friends.some(friend => friend.id === id))) throw new DomainError('not_friends')
    for (const friend of friends) {
      if (!owners.has(friend.id)) tick(tx, ownerId, list, friend.id, chosen.has(friend.id))
    }
  }, { behavior: 'immediate' })
}

/**
 * Every tick that puts a list on this person's page now: not one they took off themselves, of a
 * list that exists, by someone who still owns it and is still their friend, and never a list
 * they own themselves. Oldest tick first.
 */
function ticksFor(db: Db, userId: number) {
  const mine = listsOwnedBy(db, userId)
  return db.select({ listId: lists.id, token: lists.token, title: lists.title, by: shown.shownBy, name: users.displayName, addedAt: shown.addedAt })
    .from(shown)
    .innerJoin(lists, eq(lists.id, shown.listId))
    .innerJoin(listOwners, and(eq(listOwners.listId, lists.id), eq(listOwners.userId, shown.shownBy)))
    .innerJoin(users, eq(users.id, shown.shownBy))
    .where(and(eq(shown.userId, userId), isNull(shown.hiddenAt), isNull(lists.deletedAt)))
    .orderBy(asc(shown.addedAt), asc(shown.shownBy))
    .all()
    .filter(row => !mine.has(row.listId) && areFriends(db, userId, row.by))
}

/** The lists friends show this person, the one ticked last first. */
export function listShownLists(db: Db, userId: number): ShownList[] {
  const byList = new Map<number, { token: string, title: string, by: string[], last: number }>()
  for (const row of ticksFor(db, userId)) {
    const list = byList.get(row.listId) ?? { token: row.token, title: row.title, by: [], last: 0 }
    list.by.push(row.name)
    list.last = Math.max(list.last, row.addedAt.getTime())
    byList.set(row.listId, list)
  }
  return [...byList.entries()]
    .sort(([aId, a], [bId, b]) => b.last - a.last || bId - aId)
    .map(([listId, list]) => ({ token: list.token, title: list.title, owners: ownersOfList(db, listId).map(owner => owner.name), by: list.by }))
}

/** The ids of the lists friends show this person now. */
export function shownListIds(db: Db, userId: number): Set<number> {
  return new Set(ticksFor(db, userId).map(row => row.listId))
}

export function isShownTo(db: Db, userId: number, listId: number): boolean {
  return shownListIds(db, userId).has(listId)
}

/**
 * The friend takes a shown list off their own page. Every owner's tick for them is marked, and
 * stays: the owners aren't told, and see their tick as it was. It shows again when an owner
 * unticks and ticks it anew.
 */
export function hideShownList(db: Db, userId: number, listToken: string): void {
  db.transaction((tx) => {
    const visible = ticksFor(tx, userId).filter(row => row.token === listToken)
    if (visible.length === 0) throw new DomainError('not_found')
    tx.update(shown).set({ hiddenAt: new Date() })
      .where(and(eq(shown.listId, visible[0]!.listId), eq(shown.userId, userId))).run()
  }, { behavior: 'immediate' })
}

/** The person's friends, with what goes each way. Nothing here is about anyone else's friends. */
export function listFriends(db: Db, userId: number): FriendView[] {
  const own = ownLists(db, userId)
  const given = db.select({ listId: shown.listId, friendId: shown.userId }).from(shown).where(eq(shown.shownBy, userId)).all()
  const got = ticksFor(db, userId)
  return friendsOf(db, userId).map((friend) => {
    const theirs = listsOwnedBy(db, friend.id)
    return {
      ...friend,
      // Not the lists this friend owns too: those are theirs already, and have no switch.
      shows: own.filter(list => !theirs.has(list.id))
        .map(list => ({ token: list.token, title: list.title, shown: given.some(row => row.listId === list.id && row.friendId === friend.id) })),
      sees: got.filter(row => row.by === friend.id).map(row => ({ token: row.token, title: row.title })),
    }
  })
}

/**
 * Stops two people being friends. Nobody is told. What each showed the other goes with it, and
 * what they were told about that; if they become friends again, they start with nothing ticked.
 */
export function removeFriend(db: Db, userId: number, friendId: number): void {
  db.transaction((tx) => {
    const gone = tx.delete(friendships).where(isPair(userId, friendId)).returning({ userLow: friendships.userLow }).get()
    if (!gone) throw new DomainError('not_friends')
    for (const [owner, friend] of [[userId, friendId], [friendId, userId]] as const) {
      tx.delete(shown).where(and(eq(shown.shownBy, owner), eq(shown.userId, friend))).run()
      tx.delete(notices).where(and(eq(notices.kind, 'list_shown'), eq(notices.actorId, owner), eq(notices.userId, friend))).run()
    }
  }, { behavior: 'immediate' })
}
