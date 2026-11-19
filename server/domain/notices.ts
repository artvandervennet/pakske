import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { listFriends, listOwners, lists, listWishes, notices, users, wishes, wishLinks } from '../db/schema'
import type { NoticeKind, NoticeView } from '../../shared/schemas/list'
import { onListNow } from './placement'

// Messages for one person inside the site: what other owners did with their wishes and lists.
// They are made only by owner actions (linking, unlinking, links used, lists joined), so nothing
// a buyer does can ever show up here.

/** Leaves a notice for one person. Runs in the caller's transaction. */
export function addNotice(db: Db, notice: {
  userId: number
  kind: NoticeKind
  actorId: number
  title: string
  more?: number
  wishId?: number
  listId?: number
}): void {
  db.insert(notices).values(notice).run()
}

/** The person's notices, newest first. */
export function listNotices(db: Db, userId: number): NoticeView[] {
  const rows = db.select({ notice: notices, actor: users.displayName }).from(notices)
    .innerJoin(users, eq(users.id, notices.actorId))
    .where(eq(notices.userId, userId))
    // Of notices made in the same millisecond, the one inserted last comes first.
    .orderBy(desc(notices.createdAt), desc(sql`${notices}.rowid`))
    .all()
  return rows.map(({ notice, actor }) => {
    const token = notice.kind === 'list_shown' ? shownToken(db, userId, notice.listId) : noticeToken(db, userId, notice.wishId, notice.listId)
    const undoable = notice.kind === 'wish_linked' && token !== null && notice.wishId !== null
      && db.select({ id: wishLinks.id }).from(wishLinks)
        .where(and(eq(wishLinks.wishId, notice.wishId), eq(wishLinks.userId, notice.actorId))).get() !== undefined
    return {
      id: notice.id,
      kind: notice.kind as NoticeKind,
      actor,
      actorId: notice.actorId,
      title: notice.title,
      more: notice.more,
      token,
      wishId: notice.wishId,
      canUndo: undoable,
      fresh: notice.seenAt === null,
      createdAt: notice.createdAt.toISOString(),
    }
  })
}

/**
 * Where the notice can take its recipient: a live list of theirs that shows the wish now, or the
 * notice's own list while they still own it. Null when neither is there any more.
 */
function noticeToken(db: Db, userId: number, wishId: number | null, listId: number | null): string | null {
  if (wishId !== null) {
    const shown = db.select({ token: lists.token }).from(listWishes)
      .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
      .innerJoin(lists, eq(lists.id, listWishes.listId))
      .innerJoin(listOwners, eq(listOwners.listId, lists.id))
      .where(and(eq(listWishes.wishId, wishId), eq(listOwners.userId, userId), onListNow))
      .orderBy(asc(lists.id))
      .get()
    if (shown) return shown.token
  }
  if (listId !== null) {
    const own = db.select({ token: lists.token }).from(lists)
      .innerJoin(listOwners, eq(listOwners.listId, lists.id))
      .where(and(eq(lists.id, listId), eq(listOwners.userId, userId), isNull(lists.deletedAt)))
      .get()
    if (own) return own.token
  }
  return null
}

/**
 * Where a "shows you this list" notice leads: the list, while a friend who owns it still shows
 * it to the recipient and they haven't taken it off their page.
 */
function shownToken(db: Db, userId: number, listId: number | null): string | null {
  if (listId === null) return null
  const shown = db.select({ token: lists.token }).from(listFriends)
    .innerJoin(lists, eq(lists.id, listFriends.listId))
    .innerJoin(listOwners, and(eq(listOwners.listId, lists.id), eq(listOwners.userId, listFriends.shownBy)))
    .where(and(eq(listFriends.listId, listId), eq(listFriends.userId, userId), isNull(listFriends.hiddenAt), isNull(lists.deletedAt)))
    .get()
  return shown?.token ?? null
}

export function countUnseen(db: Db, userId: number): number {
  return db.select({ unseen: count() }).from(notices)
    .where(and(eq(notices.userId, userId), isNull(notices.seenAt))).get()!.unseen
}

export function markNoticesSeen(db: Db, userId: number): void {
  db.update(notices).set({ seenAt: new Date() })
    .where(and(eq(notices.userId, userId), isNull(notices.seenAt))).run()
}
