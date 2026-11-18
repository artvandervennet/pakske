import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import type { InviteInput, ListTarget } from '../../shared/schemas/input'
import type { InviteView } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { invites, inviteUses, inviteWishes, listOwners, lists, listWishes, users, wishes } from '../db/schema'
import { DomainError } from './errors'
import { assertListRoom, listMyLists, ownedListId, ownersOfList, targetListId, wishesMarkedOn } from './lists'
import { addNotice } from './notices'
import { assertRoom, onListNow, ownsWish, putOnList, settleOwners } from './placement'
import { toPublicWish } from './public-wishes'
import { copyWishOnto } from './sharing'
import { newListToken } from './tokens'

// Links that share: an owner of a list makes one for some wishes on it, or for the list itself.
// A "linked" link makes whoever opens it an owner, of those wishes or of the whole list, and
// works once. A "copy" link (wishes only) gives everyone who opens it copies of their own, once
// per account, until it expires; the wishes it was made for stay their owners' alone. A link has
// a token of its own and never hands out the list's, so it gives nothing once it is closed.
// Nothing here reads what buyers did.

/** Open links a list may have at once; making one more drops the oldest. */
export const MAX_OPEN_INVITES = 20

/** How long a copy link works. It can be passed around, so it must end by itself. */
export const COPY_LINK_DAYS = 30

type InviteState = InviteView['state']

/** The wishes of the link that are on its list now, in the list's order. */
function wishesStillOn(db: Db, inviteId: number, listId: number) {
  return db.select({ wish: wishes }).from(inviteWishes)
    .innerJoin(wishes, eq(wishes.id, inviteWishes.wishId))
    .innerJoin(listWishes, and(eq(listWishes.wishId, wishes.id), eq(listWishes.listId, listId)))
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .where(and(eq(inviteWishes.inviteId, inviteId), onListNow))
    .orderBy(asc(listWishes.position), asc(wishes.createdAt), asc(wishes.id))
    .all()
    .map(({ wish }) => wish)
}

/**
 * The link behind a token, its list and the wishes it can still give, and what it is to this
 * person. It is closed for everyone once its list is deleted, its maker no longer owns the list,
 * none of its wishes is on the list any more, or, for a linked link, someone used it. A copy
 * link past its time is expired. Otherwise it is the maker's own, or used by this person (a copy
 * link they took already), or open.
 */
function findInvite(db: Db, token: string, viewerId: number) {
  const invite = db.select().from(invites).where(eq(invites.token, token)).get()
  if (!invite) return undefined
  const list = db.select().from(lists).where(eq(lists.id, invite.listId)).get()!
  const owners = ownersOfList(db, list.id)
  const onList = invite.kind === 'wishes' ? wishesStillOn(db, invite.id, list.id) : []
  const gives = list.deletedAt === null
    && owners.some(owner => owner.userId === invite.createdBy)
    && (invite.kind === 'list' || onList.length > 0)

  let state: InviteState = 'open'
  if (!gives || invite.usedAt !== null) state = 'closed'
  else if (invite.expiresAt !== null && invite.expiresAt.getTime() <= Date.now()) state = 'expired'
  else if (invite.createdBy === viewerId) state = 'own'
  else if (usedBy(db, invite.id, viewerId)) state = 'used'
  return { invite, list, owners, onList, state }
}

/** Whether this person took the copies of this link before. */
function usedBy(db: Db, inviteId: number, userId: number): boolean {
  return db.select({ userId: inviteUses.userId }).from(inviteUses)
    .where(and(eq(inviteUses.inviteId, inviteId), eq(inviteUses.userId, userId))).get() !== undefined
}

/**
 * Makes a link for some wishes on the person's list, linked or as copies, or for the list
 * itself. Every wish must be on that list now; anything else is "not found", like a list that
 * isn't theirs.
 */
export function createInvite(db: Db, userId: number, token: string, input: InviteInput): { invite: string } {
  return db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    const wishIds = input.kind === 'wishes' ? [...new Set(input.wishIds)] : []
    if (wishIds.length > 0) {
      const shown = tx.select({ wishId: listWishes.wishId }).from(listWishes)
        .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
        .innerJoin(lists, eq(lists.id, listWishes.listId))
        .where(and(eq(listWishes.listId, listId), inArray(listWishes.wishId, wishIds), onListNow))
        .all()
      if (shown.length !== wishIds.length) throw new DomainError('not_found')
    }

    // Links nobody used pile up when people make one and don't send it, so the oldest goes. A
    // copy link stays open after someone used it, so it counts until it expires.
    const now = new Date()
    const open = tx.select({ id: invites.id }).from(invites)
      .where(and(eq(invites.listId, listId), isNull(invites.usedAt), or(isNull(invites.expiresAt), gt(invites.expiresAt, now))))
      .orderBy(asc(invites.id))
      .all()
    const dropping = open.slice(0, Math.max(0, open.length - (MAX_OPEN_INVITES - 1)))
    if (dropping.length > 0) tx.delete(invites).where(inArray(invites.id, dropping.map(row => row.id))).run()

    const copies = input.kind === 'wishes' && input.mode === 'copy'
    const made = tx.insert(invites).values({
      token: newListToken(),
      kind: input.kind,
      listId,
      createdBy: userId,
      mode: copies ? 'copy' : 'linked',
      expiresAt: copies ? new Date(now.getTime() + COPY_LINK_DAYS * 24 * 60 * 60 * 1000) : null,
    }).returning({ id: invites.id, token: invites.token }).get()
    if (wishIds.length > 0) tx.insert(inviteWishes).values(wishIds.map(wishId => ({ inviteId: made.id, wishId }))).run()
    return { invite: made.token }
  }, { behavior: 'immediate' })
}

/**
 * What the link shows the person who opened it, or undefined for a token that matches no link.
 * Its wishes are shown only while this person can use it, and only those still on the list.
 */
export function getInviteView(db: Db, invite: string, viewerId: number): InviteView | undefined {
  const found = findInvite(db, invite, viewerId)
  if (!found) return undefined
  const from = db.select({ name: users.displayName }).from(users).where(eq(users.id, found.invite.createdBy)).get()!
  return {
    kind: found.invite.kind,
    mode: found.invite.mode,
    // A spent or expired link is closed for its maker too: sending it on would only lead to a refusal.
    state: found.state,
    from: from.name,
    listTitle: found.list.title,
    wishes: found.state === 'open'
      ? found.onList.map(wish => ({
          id: wish.id,
          title: wish.title,
          image: toPublicWish(wish).image,
          owned: ownsWish(db, wish.id, viewerId),
        }))
      : [],
    mine: listMyLists(db, viewerId),
  }
}

/**
 * The wishes of the link the person takes, in the list's order: all that are still on the list,
 * or the ones they named. A named wish the link can't give now is "not found", so they never
 * get less than they asked for without being told.
 */
function chosenFrom<Wish extends { id: number }>(onList: Wish[], wishIds: number[] | undefined): Wish[] {
  if (!wishIds) return onList
  const named = new Set(wishIds)
  if (named.size === 0) throw new DomainError('validation')
  const chosen = onList.filter(wish => named.has(wish.id))
  if (chosen.length !== named.size) throw new DomainError('not_found')
  return chosen
}

/**
 * Uses the link. For wishes, the chosen ones (all of them unless `wishIds` names some) go on a
 * list of the person's own. Linked: they become an owner of each, the ones they own already are
 * left alone, the maker is told, and the link is spent. Copy: they get a copy of each, also of
 * one they own, nobody is told, and the link is spent for this account only. For a list: the
 * person becomes one of its owners, and of every wish on it; the earlier owners are told.
 * Returns the list the person can go to now. It all happens in one transaction, so of two
 * people at once only one gets a link that works once.
 */
export function acceptInvite(db: Db, userId: number, invite: string, target: ListTarget | null, wishIds?: number[]): { token: string } {
  return db.transaction((tx) => {
    const found = findInvite(tx, invite, userId)
    if (!found) throw new DomainError('not_found')
    if (found.state === 'own') throw new DomainError('forbidden')
    if (found.state !== 'open') throw new DomainError('invite_closed')
    const { list, owners, onList } = found
    const maker = found.invite.createdBy

    if (found.invite.kind === 'list') {
      if (owners.some(owner => owner.userId === userId)) throw new DomainError('forbidden')
      assertListRoom(tx, userId)
      tx.insert(listOwners).values({ listId: list.id, userId }).run()
      settleOwners(tx, wishesMarkedOn(tx, list.id))
      for (const owner of owners) {
        addNotice(tx, { userId: owner.userId, kind: 'list_joined', actorId: userId, title: list.title, listId: list.id })
      }
      tx.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, found.invite.id)).run()
      return { token: list.token }
    }

    if (!target) throw new DomainError('validation')
    const chosen = chosenFrom(onList, wishIds)
    if (found.invite.mode === 'copy') {
      const landing = targetListId(tx, userId, target)
      assertRoom(tx, landing.id, chosen.length)
      for (const wish of chosen) copyWishOnto(tx, wish, landing.id)
      tx.insert(inviteUses).values({ inviteId: found.invite.id, userId }).run()
      return { token: landing.token }
    }

    // Someone who owns every chosen wish already has nothing to gain; the link stays for another.
    const arriving = chosen.filter(wish => !ownsWish(tx, wish.id, userId))
    if (arriving.length === 0) throw new DomainError('forbidden')
    const landing = targetListId(tx, userId, target)
    assertRoom(tx, landing.id, arriving.length)
    for (const wish of arriving) putOnList(tx, landing.id, wish.id)
    const [first] = arriving
    addNotice(tx, { userId: maker, kind: 'joint_link_used', actorId: userId, title: first!.title, more: arriving.length - 1, wishId: first!.id })
    tx.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, found.invite.id)).run()
    return { token: landing.token }
  }, { behavior: 'immediate' })
}
