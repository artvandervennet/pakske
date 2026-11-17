import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { listOwners, listVisits, lists, users } from '../db/schema'
import type { OpenedList } from '../../shared/schemas/list'

/** A list by its token, deleted or not, with whether this person owns it. Undefined when no list has the token. */
function findList(db: Db, userId: number, token: string) {
  const list = db.select({ id: lists.id }).from(lists).where(eq(lists.token, token)).get()
  if (!list) return undefined
  const owns = db.select({ userId: listOwners.userId }).from(listOwners)
    .where(and(eq(listOwners.listId, list.id), eq(listOwners.userId, userId))).get() !== undefined
  return { id: list.id, owns }
}

/** Remembers that this person opened a list. Own lists and unknown tokens are not remembered. */
export function rememberList(db: Db, userId: number, token: string): void {
  const list = findList(db, userId, token)
  if (!list || list.owns) return
  db.insert(listVisits).values({ userId, listId: list.id })
    .onConflictDoUpdate({ target: [listVisits.userId, listVisits.listId], set: { openedAt: new Date() } })
    .run()
}

export function forgetList(db: Db, userId: number, token: string): void {
  const list = db.select({ id: lists.id }).from(lists).where(eq(lists.token, token)).get()
  if (!list) return
  db.delete(listVisits).where(and(eq(listVisits.userId, userId), eq(listVisits.listId, list.id))).run()
}

type ListRow = { id: number, token: string, title: string, deletedAt: Date | null }

function toOpened(db: Db, rows: ListRow[]): OpenedList[] {
  return rows.map(row => ({
    token: row.token,
    title: row.title,
    owners: db.select({ name: users.displayName }).from(listOwners)
      .innerJoin(users, eq(users.id, listOwners.userId))
      .where(eq(listOwners.listId, row.id))
      .orderBy(listOwners.addedAt, users.id)
      .all()
      .map(owner => owner.name),
    deleted: row.deletedAt !== null,
  }))
}

/** The lists this person opened, most recently opened first. A deleted list stays, marked as deleted. */
export function listOpenedLists(db: Db, userId: number): OpenedList[] {
  const rows = db.select({ id: lists.id, token: lists.token, title: lists.title, deletedAt: lists.deletedAt })
    .from(listVisits)
    .innerJoin(lists, eq(lists.id, listVisits.listId))
    .where(eq(listVisits.userId, userId))
    .orderBy(desc(listVisits.openedAt), desc(listVisits.listId))
    .all()
  // A list someone became an owner of after opening it is theirs now, not "opened".
  const owned = new Set(db.select({ listId: listOwners.listId }).from(listOwners).where(eq(listOwners.userId, userId)).all().map(r => r.listId))
  return toOpened(db, rows.filter(row => !owned.has(row.id)))
}

/** Describes lists by token, in the given order. Tokens that match no list are skipped. */
export function describeLists(db: Db, tokens: string[]): OpenedList[] {
  if (tokens.length === 0) return []
  const rows = db.select({ id: lists.id, token: lists.token, title: lists.title, deletedAt: lists.deletedAt })
    .from(lists).where(inArray(lists.token, tokens)).all()
  const byToken = new Map(rows.map(row => [row.token, row]))
  return toOpened(db, tokens.flatMap(token => byToken.get(token) ?? []))
}

/** Moves the lists from a logged-out cookie (newest first) into the account. Known ones stay as they are. */
export function mergeVisits(db: Db, userId: number, tokens: string[]): void {
  const base = Date.now()
  db.transaction((tx) => {
    tokens.forEach((token, index) => {
      const list = findList(tx, userId, token)
      if (!list || list.owns) return
      // Earlier in the cookie is newer, so it gets the later time.
      tx.insert(listVisits).values({ userId, listId: list.id, openedAt: new Date(base - index) })
        .onConflictDoNothing()
        .run()
    })
  }, { behavior: 'immediate' })
}
