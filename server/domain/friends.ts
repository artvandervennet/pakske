import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { friendRequests, friendships, listOwners, lists, users } from '../db/schema'
import { DomainError } from './errors'
import { addNotice } from './notices'

// Friends: two people who chose each other once, so they can share without sending links.
// There is no directory here. Someone can only be asked from a list of theirs that the asker can
// open, and nobody ever gets to see who someone else's friends are.
//
// Being friends changes nothing on a list: a friend who opens one is a buyer like anyone who has
// its link. Nothing in this file looks at what buyers did, and a test keeps it that way.

export const MAX_FRIENDS = 100
/** How many requests a person can have out at once, counting every one they still see. */
export const MAX_WAITING_REQUESTS = 20

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
 * be: asking again shows it on their page again and reaches nobody, so a decline stays silent
 * and can't be pushed past. A request the other way, also one this asker declined before, means
 * both want it: they are friends at once, and the one who asked first is told.
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
        tx.update(friendRequests).set({ hidden: false }).where(eq(friendRequests.id, mine.id)).run()
      }
      return 'asked'
    }

    if (tx.select({ id: friendRequests.id }).from(friendRequests).where(between(ownerId, userId)).get()) {
      makeFriends(tx, userId, ownerId)
      addNotice(tx, { userId: ownerId, kind: 'friend_accepted', actorId: userId, title: '' })
      return 'friends'
    }

    if (waitingFor(tx, userId) >= MAX_WAITING_REQUESTS) throw new DomainError('request_limit')
    tx.insert(friendRequests).values({ fromUser: userId, toUser: ownerId, listId: list.id }).run()
    return 'asked'
  }, { behavior: 'immediate' })
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

export interface RequestsView {
  /** Waiting for this person's answer, newest first. `via` is the list it was sent from, while that exists. */
  incoming: { id: string, fromId: number, from: string, via: string | null, fresh: boolean }[]
  /** What this person asked and still sees: waiting or declined, with nothing to tell them apart. */
  outgoing: { id: string, toId: number, to: string }[]
}

export function listRequests(db: Db, userId: number): RequestsView {
  const newestFirst = [desc(friendRequests.createdAt), desc(sql`${friendRequests}.rowid`)]
  const incoming = db.select({ request: friendRequests, from: users.displayName, title: lists.title, deletedAt: lists.deletedAt })
    .from(friendRequests)
    .innerJoin(users, eq(users.id, friendRequests.fromUser))
    .leftJoin(lists, eq(lists.id, friendRequests.listId))
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
    incoming: incoming.map(({ request, from, title, deletedAt }) => ({
      id: request.id,
      fromId: request.fromUser,
      from,
      via: title !== null && deletedAt === null ? title : null,
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

/** Stops two people being friends. Nobody is told. */
export function removeFriend(db: Db, userId: number, friendId: number): void {
  db.transaction((tx) => {
    const gone = tx.delete(friendships).where(isPair(userId, friendId)).returning({ userLow: friendships.userLow }).get()
    if (!gone) throw new DomainError('not_friends')
  }, { behavior: 'immediate' })
}
