import { alias } from 'drizzle-orm/sqlite-core'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import type { Db } from '../db/client'
import {
  friendLinks, friendRequests, friendships, invites, inviteUses, listFriends, listMessages, listOwners, lists,
  listThreads, listVisits, listWishes, notes, notices, purchases, santaGroups, santaMembers, users, wishes,
} from '../db/schema'
import { DomainError } from './errors'
import { onListNow } from './placement'

// Everything the site keeps about one person, for that person to download: the copy the privacy
// page promises. It holds what they put here and what the site recorded about them, and nothing
// the pages themselves keep from them: not who gives their wishes, not who wrote to their
// lists, not whether someone declined what they sent, and nobody else's email address. Other
// people appear by the name the person already sees on the site.

const iso = (moment: Date | null) => moment?.toISOString() ?? null
const picture = (file: string | null) => file ? `/uploads/${file}` : null

/** The copy of an account's data. `at` is the moment it says it was made. */
export function exportAccount(db: Db, userId: number, at = new Date()) {
  const me = db.select().from(users).where(eq(users.id, userId)).get()
  if (!me) throw new DomainError('not_found')
  const nameOf = (id: number | null) => id === null
    ? null
    : db.select({ name: users.displayName }).from(users).where(eq(users.id, id)).get()?.name ?? null
  // The title of a list that still exists; a deleted one is only a moment in a row of theirs.
  const liveTitle = (title: string, deletedAt: Date | null) => deletedAt === null ? title : null

  const mine = db.select({ id: lists.id, title: lists.title, note: lists.note, token: lists.token, createdAt: lists.createdAt }).from(lists)
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(and(eq(listOwners.userId, userId), isNull(lists.deletedAt)))
    .orderBy(asc(lists.id))
    .all()

  const other = alias(users, 'other')
  return {
    madeAt: at.toISOString(),
    account: {
      name: me.displayName,
      email: me.email,
      picture: picture(me.imageFile),
      googleLinked: me.googleSub !== null,
      givesAnonymouslyByDefault: me.anonymousDefault,
      madeAt: iso(me.createdAt),
    },
    lists: mine.map(list => ({
      title: list.title,
      note: list.note,
      link: `/l/${list.token}`,
      madeAt: iso(list.createdAt),
      sharedWith: db.select({ id: users.id, name: users.displayName }).from(listOwners)
        .innerJoin(users, eq(users.id, listOwners.userId))
        .where(eq(listOwners.listId, list.id))
        .all()
        .filter(owner => owner.id !== userId)
        .map(owner => owner.name),
      shownToFriends: db.select({ name: users.displayName }).from(listFriends)
        .innerJoin(users, eq(users.id, listFriends.userId))
        .where(and(eq(listFriends.listId, list.id), eq(listFriends.shownBy, userId)))
        .all()
        .map(friend => friend.name),
      wishes: db.select({ wish: wishes, addedAt: listWishes.addedAt }).from(listWishes)
        .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
        .innerJoin(lists, eq(lists.id, listWishes.listId))
        .where(and(eq(listWishes.listId, list.id), onListNow))
        .orderBy(asc(listWishes.position), asc(wishes.id))
        .all()
        .map(({ wish, addedAt }) => ({
          title: wish.title,
          description: wish.description,
          links: wish.urls ?? [],
          quantity: wish.quantity,
          picture: picture(wish.imageFile),
          addedAt: iso(addedAt),
        })),
    })),
    giving: db.select({ title: wishes.title, quantity: purchases.quantity, anonymous: purchases.anonymous, since: purchases.createdAt })
      .from(purchases).innerJoin(wishes, eq(wishes.id, purchases.wishId))
      .where(eq(purchases.userId, userId)).orderBy(asc(purchases.id)).all()
      .map(row => ({ wish: row.title, quantity: row.quantity, anonymous: row.anonymous, since: iso(row.since) })),
    notes: db.select({ title: wishes.title, body: notes.body, writtenAt: notes.createdAt })
      .from(notes).innerJoin(wishes, eq(wishes.id, notes.wishId))
      .where(eq(notes.userId, userId)).orderBy(asc(notes.createdAt)).all()
      .map(row => ({ wish: row.title, body: row.body, writtenAt: iso(row.writtenAt) })),
    messages: db.select({ title: lists.title, deletedAt: lists.deletedAt, fromOwner: listMessages.fromOwner, body: listMessages.body, writtenAt: listMessages.createdAt })
      .from(listMessages)
      .innerJoin(listThreads, eq(listThreads.id, listMessages.threadId))
      .innerJoin(lists, eq(lists.id, listThreads.listId))
      .where(eq(listMessages.userId, userId)).orderBy(asc(listMessages.createdAt)).all()
      .map(row => ({ list: liveTitle(row.title, row.deletedAt), asOwner: row.fromOwner, body: row.body, writtenAt: iso(row.writtenAt) })),
    visitedLists: db.select({ title: lists.title, deletedAt: lists.deletedAt, openedAt: listVisits.openedAt })
      .from(listVisits).innerJoin(lists, eq(lists.id, listVisits.listId))
      .where(eq(listVisits.userId, userId)).orderBy(asc(listVisits.openedAt)).all()
      .map(row => ({ list: liveTitle(row.title, row.deletedAt), lastOpenedAt: iso(row.openedAt) })),
    friends: db.select({ low: friendships.userLow, high: friendships.userHigh, since: friendships.createdAt }).from(friendships)
      .where(or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId))).all()
      .map(row => ({ name: nameOf(row.low === userId ? row.high : row.low), since: iso(row.since) })),
    friendRequests: {
      // Whether one was declined is left out: the site never tells its sender either.
      sent: db.select({ name: other.displayName, sentAt: friendRequests.createdAt }).from(friendRequests)
        .innerJoin(other, eq(other.id, friendRequests.toUser))
        .where(eq(friendRequests.fromUser, userId)).all()
        .map(row => ({ to: row.name, sentAt: iso(row.sentAt) })),
      received: db.select({ name: other.displayName, status: friendRequests.status, sentAt: friendRequests.createdAt }).from(friendRequests)
        .innerJoin(other, eq(other.id, friendRequests.fromUser))
        .where(eq(friendRequests.toUser, userId)).all()
        .map(row => ({ from: row.name, declined: row.status === 'declined', sentAt: iso(row.sentAt) })),
    },
    links: {
      // What was sent to a friend says nothing about their answer, as on the site.
      made: db.select({ kind: invites.kind, mode: invites.mode, title: lists.title, deletedAt: lists.deletedAt, sentTo: invites.sentTo, madeAt: invites.createdAt, expiresAt: invites.expiresAt })
        .from(invites).innerJoin(lists, eq(lists.id, invites.listId))
        .where(eq(invites.createdBy, userId)).orderBy(asc(invites.id)).all()
        .map(row => ({ shares: row.kind, as: row.mode, list: liveTitle(row.title, row.deletedAt), sentTo: nameOf(row.sentTo), madeAt: iso(row.madeAt), expiresAt: iso(row.expiresAt) })),
      used: db.select({ title: lists.title, deletedAt: lists.deletedAt, usedAt: inviteUses.usedAt })
        .from(inviteUses).innerJoin(invites, eq(invites.id, inviteUses.inviteId)).innerJoin(lists, eq(lists.id, invites.listId))
        .where(eq(inviteUses.userId, userId)).all()
        .map(row => ({ list: liveTitle(row.title, row.deletedAt), usedAt: iso(row.usedAt) })),
      friendLinks: db.select({ madeAt: friendLinks.createdAt, expiresAt: friendLinks.expiresAt, usedAt: friendLinks.usedAt }).from(friendLinks)
        .where(eq(friendLinks.createdBy, userId)).orderBy(asc(friendLinks.id)).all()
        .map(row => ({ madeAt: iso(row.madeAt), expiresAt: iso(row.expiresAt), usedAt: iso(row.usedAt) })),
    },
    secretSanta: db.select({ title: santaGroups.title, joinedAt: santaMembers.joinedAt, listId: santaMembers.listId, givesTo: santaMembers.givesTo })
      .from(santaMembers).innerJoin(santaGroups, eq(santaGroups.id, santaMembers.groupId))
      .where(eq(santaMembers.userId, userId)).orderBy(asc(santaMembers.joinedAt)).all()
      .map(row => ({
        group: row.title,
        joinedAt: iso(row.joinedAt),
        list: mine.find(list => list.id === row.listId)?.title ?? null,
        drew: nameOf(row.givesTo),
      })),
    // What happened and to what, as the row has it. Who did it is left to the site, which
    // decides per notice whether a name may be shown.
    notices: db.select({ kind: notices.kind, title: notices.title, at: notices.createdAt, seenAt: notices.seenAt }).from(notices)
      .where(eq(notices.userId, userId)).orderBy(asc(notices.createdAt)).all()
      .map(row => ({ kind: row.kind, about: row.title, at: iso(row.at), seenAt: iso(row.seenAt) })),
  }
}

export type AccountExport = ReturnType<typeof exportAccount>
