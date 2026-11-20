import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { listOwners, listVisits, lists, users } from '../db/schema'
import type { OpenedList } from '../../shared/schemas/list'
import { hideShownList, listShownLists, shownListIds } from './friends'
import { groupListIds, listGroupLists } from './santa'

/** A list by its token, deleted or not, with whether this person owns it. Undefined when no list has the token. */
function findList(db: Db, userId: number, token: string) {
  const list = db.select({ id: lists.id }).from(lists).where(eq(lists.token, token)).get()
  if (!list) return undefined
  const owns = db.select({ userId: listOwners.userId }).from(listOwners)
    .where(and(eq(listOwners.listId, list.id), eq(listOwners.userId, userId))).get() !== undefined
  return { id: list.id, owns }
}

/**
 * Remembers that this person opened a list, now. Not a list a friend shows them at that moment. A list of someone else's goes on their visited
 * lists; a list of their own moves to the front of their own lists (`listOwnedLists`), and is
 * never shown as visited while they own it. Unknown tokens are not remembered.
 */
export function rememberList(db: Db, userId: number, token: string): void {
  const list = findList(db, userId, token)
  if (!list) return
  // A list a friend shows them is on their page without its link; opening it there is no visit,
  // or it would stay behind as a visited list after the friend stops showing it. The same goes
  // for a list a Secret Santa group shows them.
  if (!list.owns && (shownListIds(db, userId).has(list.id) || groupListIds(db, userId).has(list.id))) return
  db.insert(listVisits).values({ userId, listId: list.id })
    .onConflictDoUpdate({ target: [listVisits.userId, listVisits.listId], set: { openedAt: new Date() } })
    .run()
}

/**
 * Takes a list off the person's visited lists. A list of their own is left alone: there the
 * visit only says when they last opened it, and nothing shows it as visited.
 */
export function forgetList(db: Db, userId: number, token: string): void {
  const list = findList(db, userId, token)
  if (!list || list.owns) return
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

/**
 * The lists of other people that this person opened, most recently opened first. A deleted list
 * stays, marked as deleted. A list they stopped owning is here only when they opened it themselves.
 */
export function listOpenedLists(db: Db, userId: number): OpenedList[] {
  const rows = db.select({ id: lists.id, token: lists.token, title: lists.title, deletedAt: lists.deletedAt })
    .from(listVisits)
    .innerJoin(lists, eq(lists.id, listVisits.listId))
    .where(eq(listVisits.userId, userId))
    .orderBy(desc(listVisits.openedAt), desc(listVisits.listId))
    .all()
  // Opening a list of your own is remembered too, and a list can become yours after you opened
  // it. Either way it is under your own lists, deleted ones included, and not here.
  const owned = new Set(db.select({ listId: listOwners.listId }).from(listOwners).where(eq(listOwners.userId, userId)).all().map(r => r.listId))
  // A list a friend shows the person is under "from friends" while it is shown, not here as well.
  // Neither is one a Secret Santa group shows them.
  const shown = shownListIds(db, userId)
  const viaGroup = groupListIds(db, userId)
  return toOpened(db, rows.filter(row => !owned.has(row.id) && !shown.has(row.id) && !viaGroup.has(row.id)))
}

/**
 * Other people's lists on this person's page, as one row: the lists friends show them, the one
 * switched on last first; then the lists the members of their Secret Santa groups put in; and
 * then the lists they opened by a link, the one opened last first. A list is never in it twice:
 * while a friend or a group shows it, it isn't a visited list as well, and one that both show
 * is the friend's.
 */
export function listOthersLists(db: Db, userId: number): OpenedList[] {
  const shown = listShownLists(db, userId).map(({ token, title, owners }) => ({ token, title, owners, deleted: false }))
  const fromFriends = new Set(shown.map(list => list.token))
  const viaGroup = listGroupLists(db, userId).filter(list => !fromFriends.has(list.token))
  const groupsOf = new Map(viaGroup.map(list => [list.token, list.groups]))
  const fromGroups = toOpened(db, viaGroup.map(list => ({ ...list, deletedAt: null }))).map(list => ({ ...list, santa: groupsOf.get(list.token)! }))
  return [...shown, ...fromGroups, ...listOpenedLists(db, userId)]
}

/**
 * Takes someone else's list off this person's page, whichever way it got there: the visit is
 * forgotten, and a list a friend shows them is hidden for them alone. The friend isn't told and
 * the list's link keeps working; opening it again puts it back. A list a Secret Santa group
 * shows them stays: it goes with the group, and the page offers no "Weghalen" for it.
 */
export function takeOffPage(db: Db, userId: number, token: string): void {
  forgetList(db, userId, token)
  if (listShownLists(db, userId).some(list => list.token === token)) hideShownList(db, userId, token)
}

/** Describes lists by token, in the given order. Tokens that match no list are skipped. */
export function describeLists(db: Db, tokens: string[]): OpenedList[] {
  if (tokens.length === 0) return []
  const rows = db.select({ id: lists.id, token: lists.token, title: lists.title, deletedAt: lists.deletedAt })
    .from(lists).where(inArray(lists.token, tokens)).all()
  const byToken = new Map(rows.map(row => [row.token, row]))
  return toOpened(db, tokens.flatMap(token => byToken.get(token) ?? []))
}

/**
 * Moves the lists from a logged-out cookie (newest first) into the account. Known ones stay as
 * they are, and the person's own lists are skipped: logging in is not opening them.
 */
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
