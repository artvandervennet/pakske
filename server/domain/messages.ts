import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'
import type { ListThread, NoticeKind } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { listMessages, listThreads, lists, notices, users } from '../db/schema'
import { DomainError } from './errors'
import { ownedListId, ownersOfList } from './lists'
import { addNotice } from './notices'

// Writing to the owners of a list without a name. Someone who opened a list has one conversation
// with its owners; the owners answer in it, with their name. An owner is sent a conversation's
// random id and its words and nothing else: who it is with is read here only to find the
// person's own conversation and to tell them of an answer, and is never put in an answer to
// anyone. Nothing here looks at what anyone ticked, so writing changes nothing an owner sees of
// their wishes.

const MAX_MESSAGES_PER_THREAD = 200
const MAX_THREADS_PER_LIST = 200

type Thread = typeof listThreads.$inferSelect

/** A list that can be written on: one that exists and isn't deleted. */
function liveList(db: Db, token: string) {
  const list = db.select({ id: lists.id, title: lists.title }).from(lists)
    .where(and(eq(lists.token, token), isNull(lists.deletedAt))).get()
  if (!list) throw new DomainError('not_found')
  return list
}

/**
 * Leaves the one notice a person has about messages on a list: a newer one takes the place of
 * the one before, so ten messages are one row behind the bell.
 */
function tell(db: Db, userId: number, kind: NoticeKind, actorId: number, list: { id: number, title: string }): void {
  db.delete(notices).where(and(eq(notices.userId, userId), eq(notices.kind, kind), eq(notices.listId, list.id))).run()
  addNotice(db, { userId, kind, actorId, title: list.title, listId: list.id })
}

/**
 * Writes a message on a list. From someone who doesn't own it, it goes to the owners, in that
 * person's own conversation, which starts with their first message. From an owner it is an
 * answer and has to name the conversation it answers. The other side gets a notice: the owners
 * one that names nobody, the person who wrote one that names the owner who answered.
 */
export function sendMessage(db: Db, userId: number, token: string, body: string, threadId?: string): { id: string, thread: string } {
  return db.transaction((tx) => {
    const list = liveList(tx, token)
    const owners = ownersOfList(tx, list.id).map(owner => owner.userId)
    const fromOwner = owners.includes(userId)

    let thread: Thread | undefined
    if (fromOwner) {
      // An owner has nobody to write to but someone who wrote first.
      if (threadId === undefined) throw new DomainError('forbidden')
      thread = tx.select().from(listThreads).where(and(eq(listThreads.id, threadId), eq(listThreads.listId, list.id))).get()
      if (!thread) throw new DomainError('not_found')
    }
    else {
      // A list whose owners' accounts are gone has nobody to read it.
      if (owners.length === 0) throw new DomainError('forbidden')
      thread = tx.select().from(listThreads).where(and(eq(listThreads.listId, list.id), eq(listThreads.userId, userId))).get()
      if (!thread) {
        const { total } = tx.select({ total: count() }).from(listThreads).where(eq(listThreads.listId, list.id)).get()!
        if (total >= MAX_THREADS_PER_LIST) throw new DomainError('message_limit')
        thread = tx.insert(listThreads).values({ listId: list.id, userId }).returning().get()
      }
    }

    const { total } = tx.select({ total: count() }).from(listMessages).where(eq(listMessages.threadId, thread.id)).get()!
    if (total >= MAX_MESSAGES_PER_THREAD) throw new DomainError('message_limit')
    const message = tx.insert(listMessages).values({ threadId: thread.id, fromOwner, userId, body }).returning({ id: listMessages.id }).get()

    if (!fromOwner) {
      // The notice's actor is the owner themselves: the row then holds nothing about who wrote,
      // and `listNotices` sends no name with it.
      for (const owner of owners) tell(tx, owner, 'list_message', owner, list)
    }
    else if (thread.userId !== null && !owners.includes(thread.userId)) {
      tell(tx, thread.userId, 'message_answered', userId, list)
    }
    return { id: message.id, thread: thread.id }
  }, { behavior: 'immediate' })
}

/**
 * The conversations on a list as this person may read them: an owner gets all of them, the one
 * with the newest message first; anyone else their own, if they wrote. Each message says
 * whether an owner wrote it and, only then, that owner's name. Nobody for a list that is gone.
 */
export function threadsFor(db: Db, viewerId: number, token: string): ListThread[] {
  const list = db.select({ id: lists.id }).from(lists).where(and(eq(lists.token, token), isNull(lists.deletedAt))).get()
  if (!list) return []
  const owns = ownersOfList(db, list.id).some(owner => owner.userId === viewerId)
  const rows = db.select({
    thread: listThreads.id,
    id: listMessages.id,
    fromOwner: listMessages.fromOwner,
    userId: listMessages.userId,
    name: users.displayName,
    body: listMessages.body,
    createdAt: listMessages.createdAt,
  }).from(listMessages)
    .innerJoin(listThreads, eq(listThreads.id, listMessages.threadId))
    // Only an owner's name is looked up: the other side's never leaves the table.
    .leftJoin(users, and(eq(users.id, listMessages.userId), eq(listMessages.fromOwner, true)))
    .where(and(eq(listThreads.listId, list.id), owns ? undefined : eq(listThreads.userId, viewerId)))
    // Of messages from the same millisecond, the one written first comes first.
    .orderBy(asc(listMessages.createdAt), asc(sql`${listMessages}.rowid`))
    .all()

  const threads = new Map<string, ListThread>()
  for (const row of rows) {
    const thread = threads.get(row.thread) ?? { id: row.thread, messages: [] }
    // Put back at the end, so the conversations end up in the order of their last message.
    threads.delete(row.thread)
    threads.set(row.thread, thread)
    thread.messages.push({
      id: row.id,
      fromOwner: row.fromOwner,
      owner: row.fromOwner ? row.name : null,
      mine: row.userId === viewerId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    })
  }
  return [...threads.values()].reverse()
}

/**
 * Deletes a message its writer wrote. For anyone else the answer is "not found", the same as
 * for a message that doesn't exist. A conversation without messages is gone.
 */
export function deleteMessage(db: Db, userId: number, messageId: string): void {
  db.transaction((tx) => {
    const gone = tx.delete(listMessages).where(and(eq(listMessages.id, messageId), eq(listMessages.userId, userId)))
      .returning({ threadId: listMessages.threadId }).get()
    if (!gone) throw new DomainError('not_found')
    const left = tx.select({ id: listMessages.id }).from(listMessages).where(eq(listMessages.threadId, gone.threadId)).get()
    if (!left) tx.delete(listThreads).where(eq(listThreads.id, gone.threadId)).run()
  }, { behavior: 'immediate' })
}

/**
 * An owner deletes a whole conversation on their list, for everyone. Whoever it was with can
 * start a new one, which the owners can't tell from a first message by someone else.
 */
export function deleteThread(db: Db, userId: number, token: string, threadId: string): void {
  db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    const gone = tx.delete(listThreads).where(and(eq(listThreads.id, threadId), eq(listThreads.listId, listId)))
      .returning({ id: listThreads.id }).get()
    if (!gone) throw new DomainError('not_found')
  }, { behavior: 'immediate' })
}
