import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import type { InviteInput, ListTarget } from '../../shared/schemas/input'
import type { InviteView } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { invites, inviteWishes, listOwners, lists, listWishes, users, wishes } from '../db/schema'
import { DomainError } from './errors'
import { assertListRoom, listMyLists, ownedListId, ownersOfList, targetListId, wishesMarkedOn } from './lists'
import { addNotice } from './notices'
import { assertRoom, onListNow, putOnList, settleOwners } from './placement'
import { toPublicWish } from './public-wishes'
import { newListToken } from './tokens'

// Links that work once: an owner of a list makes one, and whoever opens it becomes an owner of
// some wishes on that list, or of the whole list. A link has a token of its own and never hands
// out the list's, so it gives nothing once it is spent. Nothing here reads what buyers did.

/** Unused links a list may have at once; making one more drops the oldest. */
export const MAX_OPEN_INVITES = 20

/** The wishes of the link that are on its list now, in the list's order. */
function wishesStillOn(db: Db, inviteId: number, listId: number) {
  return db.select({ wish: wishes }).from(inviteWishes)
    .innerJoin(wishes, eq(wishes.id, inviteWishes.wishId))
    .innerJoin(listWishes, and(eq(listWishes.wishId, wishes.id), eq(listWishes.listId, listId)))
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .where(and(eq(inviteWishes.inviteId, inviteId), onListNow))
    .orderBy(asc(wishes.createdAt), asc(wishes.id))
    .all()
    .map(({ wish }) => toPublicWish(wish))
}

/**
 * The link behind a token, its list and the wishes it can still give, and whether it can be used.
 * It can't once it was used, its list is deleted, its maker no longer owns the list, or none of
 * its wishes is on the list any more.
 */
function findInvite(db: Db, token: string) {
  const invite = db.select().from(invites).where(eq(invites.token, token)).get()
  if (!invite) return undefined
  const list = db.select().from(lists).where(eq(lists.id, invite.listId)).get()!
  const owners = ownersOfList(db, list.id)
  const onList = invite.kind === 'wishes' ? wishesStillOn(db, invite.id, list.id) : []
  const open = invite.usedAt === null
    && list.deletedAt === null
    && owners.some(owner => owner.userId === invite.createdBy)
    && (invite.kind === 'list' || onList.length > 0)
  return { invite, list, owners, onList, open }
}

/**
 * Makes a link for some wishes on the person's list, or for the list itself. Every wish must be
 * on that list now; anything else is "not found", like a list that isn't theirs.
 */
export function createInvite(db: Db, userId: number, token: string, input: InviteInput): { invite: string } {
  return db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    const wishIds = input.kind === 'wishes' ? [...new Set(input.wishIds)] : []
    if (wishIds.length > 0) {
      const { shown } = tx.select({ shown: count() }).from(listWishes)
        .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
        .innerJoin(lists, eq(lists.id, listWishes.listId))
        .where(and(eq(listWishes.listId, listId), inArray(listWishes.wishId, wishIds), onListNow))
        .get()!
      if (shown !== wishIds.length) throw new DomainError('not_found')
    }

    // Links nobody used pile up when people make one and don't send it, so the oldest goes.
    const unused = tx.select({ id: invites.id }).from(invites)
      .where(and(eq(invites.listId, listId), isNull(invites.usedAt)))
      .orderBy(asc(invites.id))
      .all()
    const dropping = unused.slice(0, Math.max(0, unused.length - (MAX_OPEN_INVITES - 1)))
    if (dropping.length > 0) tx.delete(invites).where(inArray(invites.id, dropping.map(row => row.id))).run()

    const made = tx.insert(invites).values({ token: newListToken(), kind: input.kind, listId, createdBy: userId })
      .returning({ id: invites.id, token: invites.token }).get()
    if (wishIds.length > 0) tx.insert(inviteWishes).values(wishIds.map(wishId => ({ inviteId: made.id, wishId }))).run()
    return { invite: made.token }
  }, { behavior: 'immediate' })
}

/**
 * What the link shows the person who opened it, or undefined for a token that matches no link.
 * Its wishes are shown only while it can be used, and only those still on the list.
 */
export function getInviteView(db: Db, invite: string, viewerId: number): InviteView | undefined {
  const found = findInvite(db, invite)
  if (!found) return undefined
  // A spent link is closed for its maker too: sending it on would only lead to a refusal.
  const state = !found.open ? 'closed' : found.invite.createdBy === viewerId ? 'own' : 'open'
  const from = db.select({ name: users.displayName }).from(users).where(eq(users.id, found.invite.createdBy)).get()!
  return {
    kind: found.invite.kind,
    state,
    from: from.name,
    listTitle: found.list.title,
    wishes: state === 'open'
      ? found.onList.map(wish => ({ id: wish.id, title: wish.title, image: wish.image }))
      : [],
    mine: listMyLists(db, viewerId),
  }
}

/**
 * Uses the link. For wishes: the ones still on the list go on a list of the person's own, and
 * they become an owner of each; the maker is told. For a list: the person becomes one of its
 * owners, and of every wish on it; the earlier owners are told. Returns the list the person can
 * go to now. The link is spent in the same transaction, so of two people at once only one gets it.
 */
export function acceptInvite(db: Db, userId: number, invite: string, target: ListTarget | null): { token: string } {
  return db.transaction((tx) => {
    const found = findInvite(tx, invite)
    if (!found) throw new DomainError('not_found')
    if (!found.open) throw new DomainError('invite_closed')
    const { list, owners, onList } = found
    const maker = found.invite.createdBy
    if (userId === maker) throw new DomainError('forbidden')

    let token: string
    if (found.invite.kind === 'wishes') {
      if (!target) throw new DomainError('validation')
      const landing = targetListId(tx, userId, target)
      const arriving = onList.filter(wish => tx.select({ wishId: listWishes.wishId }).from(listWishes)
        .where(and(eq(listWishes.listId, landing.id), eq(listWishes.wishId, wish.id), isNull(listWishes.removedAt)))
        .get() === undefined)
      if (arriving.length > 0) assertRoom(tx, landing.id, arriving.length)
      for (const wish of arriving) putOnList(tx, landing.id, wish.id)
      const [first] = onList
      addNotice(tx, { userId: maker, kind: 'joint_link_used', actorId: userId, title: first!.title, more: onList.length - 1, wishId: first!.id })
      token = landing.token
    }
    else {
      if (owners.some(owner => owner.userId === userId)) throw new DomainError('forbidden')
      assertListRoom(tx, userId)
      tx.insert(listOwners).values({ listId: list.id, userId }).run()
      settleOwners(tx, wishesMarkedOn(tx, list.id))
      for (const owner of owners) {
        addNotice(tx, { userId: owner.userId, kind: 'list_joined', actorId: userId, title: list.title, listId: list.id })
      }
      token = list.token
    }
    tx.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, found.invite.id)).run()
    return { token }
  }, { behavior: 'immediate' })
}
