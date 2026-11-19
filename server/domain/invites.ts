import { and, asc, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import type { InviteInput, ListTarget } from '../../shared/schemas/input'
import type { InviteView, NoticeKind } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { invites, inviteUses, inviteWishes, listOwners, lists, listWishes, users, wishes } from '../db/schema'
import { DomainError } from './errors'
import { areFriends } from './friends'
import { assertListRoom, listMyLists, ownedListId, ownersOfList, targetListId, wishesMarkedOn } from './lists'
import { addNotice } from './notices'
import { assertRoom, onListNow, ownsWish, putOnList, settleOwners } from './placement'
import { toPublicWish } from './public-wishes'
import { copyWishOnto } from './sharing'
import { newListToken } from './tokens'

// Links that share: an owner of a list makes one for some wishes on it, or for the list itself.
// A "linked" link for wishes makes whoever opens it an owner of those wishes, and works once. A
// "copy" link (wishes only) gives everyone who opens it copies of their own, once per account,
// until it expires; the wishes it was made for stay their owners' alone. A link for the list is
// an invitation: for 7 days it makes everyone who opens it a co-owner, so it can go into a
// group chat (`listInviteLink`). A link has a token of its own and never hands out the list's,
// so it gives nothing once it is closed.
// The same can be sent to a friend instead (`sendInvite`): it then has no address to pass on.
// It reaches that friend as a notice, works for them alone, and is gone once they answered.
// Nothing here reads what buyers did.

/** Open links a list may have at once; making one more drops the oldest. */
export const MAX_OPEN_INVITES = 20

/** How long a copy link works. It can be passed around, so it must end by itself. */
export const COPY_LINK_DAYS = 30

/** How long an invitation to a list works. Whoever opens it gets the whole list, so it ends soon. */
export const INVITE_LINK_DAYS = 7

const DAY = 24 * 60 * 60 * 1000

/** What one person may have waiting for one friend at once; sending one more drops the oldest. */
export const MAX_WAITING_SENDS = 20

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
 * link they took already), or open. What was sent to a friend exists for that friend only: to
 * anyone else, its sender included, its token matches nothing.
 */
function findInvite(db: Db, token: string, viewerId: number) {
  const invite = db.select().from(invites).where(eq(invites.token, token)).get()
  if (!invite) return undefined
  if (invite.sentTo !== null && invite.sentTo !== viewerId) return undefined
  const list = db.select().from(lists).where(eq(lists.id, invite.listId)).get()!
  const owners = ownersOfList(db, list.id)
  const onList = invite.kind === 'wishes' ? wishesStillOn(db, invite.id, list.id) : []
  const gives = list.deletedAt === null
    && owners.some(owner => owner.userId === invite.createdBy)
    && (invite.kind === 'list' || onList.length > 0)

  // An invitation to a list always has an end. One without is from before it worked for more
  // than one person, and must not be a way in for everyone for ever.
  const endless = invite.kind === 'list' && invite.sentTo === null && invite.expiresAt === null
  let state: InviteState = 'open'
  if (!gives || invite.usedAt !== null || endless) state = 'closed'
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
 * The wishes an owner named for a link or a send, each once and in the list's order. Every one
 * must be on that list now; anything else is "not found". None for the list itself.
 */
function namedWishes(db: Db, listId: number, input: InviteInput): { id: number, title: string }[] {
  if (input.kind !== 'wishes') return []
  const wishIds = [...new Set(input.wishIds)]
  const shown = db.select({ id: wishes.id, title: wishes.title }).from(listWishes)
    .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .where(and(eq(listWishes.listId, listId), inArray(listWishes.wishId, wishIds), onListNow))
    .orderBy(asc(listWishes.position), asc(wishes.createdAt), asc(wishes.id))
    .all()
  if (shown.length !== wishIds.length) throw new DomainError('not_found')
  return shown
}

/**
 * Makes a link for some wishes on the person's list, linked or as copies, or for the list
 * itself. Every wish must be on that list now; anything else is "not found", like a list that
 * isn't theirs.
 */
export function createInvite(db: Db, userId: number, token: string, input: InviteInput): { invite: string } {
  if (input.kind === 'list') return listInviteLink(db, userId, token)
  return db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    const wishIds = namedWishes(tx, listId, input).map(wish => wish.id)

    // Links nobody used pile up when people make one and don't send it, so the oldest goes. A
    // copy link stays open after someone used it, so it counts until it expires. What was sent
    // to a friend is no link to pass on and is counted per friend instead, and an invitation to
    // the list is one per owner and ends by itself.
    const now = new Date()
    const open = tx.select({ id: invites.id }).from(invites)
      .where(and(eq(invites.listId, listId), eq(invites.kind, 'wishes'), isNull(invites.sentTo), isNull(invites.usedAt), or(isNull(invites.expiresAt), gt(invites.expiresAt, now))))
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
      expiresAt: copies ? new Date(now.getTime() + COPY_LINK_DAYS * DAY) : null,
    }).returning({ id: invites.id, token: invites.token }).get()
    if (wishIds.length > 0) tx.insert(inviteWishes).values(wishIds.map(wishId => ({ inviteId: made.id, wishId }))).run()
    return { invite: made.token }
  }, { behavior: 'immediate' })
}

/**
 * The person's invitation link for a list of their own: everyone who opens it while it lives
 * becomes a co-owner. There is one per owner per list, so asking again gives the address that
 * is already going round, and gives it 7 days from now; once it ended, asking makes a new one.
 * It ends by itself, 7 days after its owner last asked for it.
 */
export function listInviteLink(db: Db, userId: number, token: string): { invite: string } {
  return db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    const now = new Date()
    const until = new Date(now.getTime() + INVITE_LINK_DAYS * DAY)
    const live = tx.select({ id: invites.id, token: invites.token }).from(invites)
      .where(and(eq(invites.listId, listId), eq(invites.createdBy, userId), eq(invites.kind, 'list'), isNull(invites.sentTo), gt(invites.expiresAt, now)))
      .orderBy(desc(invites.id))
      .get()
    if (live) {
      tx.update(invites).set({ expiresAt: until }).where(eq(invites.id, live.id)).run()
      return { invite: live.token }
    }
    const made = tx.insert(invites).values({ token: newListToken(), kind: 'list', listId, createdBy: userId, mode: 'linked', expiresAt: until })
      .returning({ token: invites.token }).get()
    return { invite: made.token }
  }, { behavior: 'immediate' })
}

/**
 * Sends some wishes on the person's list, or the list itself, to friends of theirs: to each what
 * a link would have given, as a notice that leads to it. Nothing changes for a friend until they
 * say yes there, and closing the notice is their no, which nobody is told. Each friend gets a
 * send of their own, so one friend's answer leaves another's waiting. Sending the same thing
 * the same way again replaces what waited. Someone who isn't a friend is "not friends", and then
 * nothing is sent to anyone; a friend who owns the list already can't be asked to manage it.
 */
export function sendInvite(db: Db, userId: number, token: string, input: InviteInput, friendIds: number[]): { sent: number } {
  return db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    const named = namedWishes(tx, listId, input)
    const wishIds = named.map(wish => wish.id)
    const friends = [...new Set(friendIds)]
    const owners = new Set(ownersOfList(tx, listId).map(owner => owner.userId))
    for (const friendId of friends) {
      if (!areFriends(tx, userId, friendId)) throw new DomainError('not_friends')
      if (input.kind === 'list' && owners.has(friendId)) throw new DomainError('forbidden')
    }

    const copies = input.kind === 'wishes' && input.mode === 'copy'
    const mode = copies ? 'copy' : 'linked'
    const kind: NoticeKind = input.kind === 'list' ? 'sent_list' : copies ? 'sent_copy' : 'sent_linked'
    const title = input.kind === 'list'
      ? tx.select({ title: lists.title }).from(lists).where(eq(lists.id, listId)).get()!.title
      : named[0]!.title
    const now = new Date()
    for (const friendId of friends) {
      const waiting = tx.select().from(invites)
        .where(and(eq(invites.createdBy, userId), eq(invites.sentTo, friendId)))
        .orderBy(asc(invites.id))
        .all()
      const again = waiting.filter(earlier => earlier.listId === listId && earlier.kind === input.kind && earlier.mode === mode
        && sameWishes(tx, earlier.id, wishIds))
      const others = waiting.filter(earlier => !again.includes(earlier))
      const dropping = [...again, ...others.slice(0, Math.max(0, others.length - (MAX_WAITING_SENDS - 1)))]
      // The notice about a send goes with it.
      if (dropping.length > 0) tx.delete(invites).where(inArray(invites.id, dropping.map(row => row.id))).run()

      const made = tx.insert(invites).values({
        token: newListToken(),
        kind: input.kind,
        listId,
        createdBy: userId,
        mode,
        expiresAt: copies ? new Date(now.getTime() + COPY_LINK_DAYS * DAY) : null,
        sentTo: friendId,
      }).returning({ id: invites.id }).get()
      if (wishIds.length > 0) tx.insert(inviteWishes).values(wishIds.map(wishId => ({ inviteId: made.id, wishId }))).run()
      addNotice(tx, { userId: friendId, kind, actorId: userId, title, more: Math.max(0, wishIds.length - 1), inviteId: made.id })
    }
    return { sent: friends.length }
  }, { behavior: 'immediate' })
}

/**
 * Takes back the invitation to co-own this list that the person sent one friend, with the
 * notice about it. The friend isn't told. It answers the same whether or not anything waited,
 * and whoever the other person is, so it can't be used to find out what became of a send.
 */
export function withdrawSend(db: Db, userId: number, token: string, friendId: number): void {
  db.transaction((tx) => {
    const listId = ownedListId(tx, userId, token)
    tx.delete(invites).where(and(eq(invites.listId, listId), eq(invites.kind, 'list'), eq(invites.createdBy, userId), eq(invites.sentTo, friendId))).run()
  }, { behavior: 'immediate' })
}

/** Whether a link or send is about exactly these wishes. */
function sameWishes(db: Db, inviteId: number, wishIds: number[]): boolean {
  const theirs = db.select({ wishId: inviteWishes.wishId }).from(inviteWishes).where(eq(inviteWishes.inviteId, inviteId)).all()
  const named = new Set(wishIds)
  return theirs.length === named.size && theirs.every(row => named.has(row.wishId))
}

/**
 * The token of what was sent to this person, while they can still take it; null once it is
 * closed, expired or taken. A notice about a send is shown only while this gives a token.
 */
export function waitingSend(db: Db, inviteId: number, userId: number): string | null {
  const sent = db.select({ token: invites.token }).from(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.sentTo, userId))).get()
  if (!sent) return null
  return findInvite(db, sent.token, userId)?.state === 'open' ? sent.token : null
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
    yours: found.invite.createdBy === viewerId,
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
 * Uses the link, or says yes to what a friend sent. For wishes, the chosen ones (all of them unless `wishIds` names some) go on a
 * list of the person's own. Linked: they become an owner of each, the ones they own already are
 * left alone, the maker is told, and the link is spent. Copy: they get a copy of each, also of
 * one they own, nobody is told, and the link is spent for this account only. For a list: the
 * person becomes one of its owners, and of every wish on it; the earlier owners are told, and
 * the link goes on working for the next person until its time is over.
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
    // A link for wishes that works once stays, spent, so its address can say so. What was sent
    // to a friend has no address anyone else knows: answered, it goes, and its notice with it.
    const sent = found.invite.sentTo !== null
    const spend = () => {
      if (sent) tx.delete(invites).where(eq(invites.id, found.invite.id)).run()
      else tx.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, found.invite.id)).run()
    }

    if (found.invite.kind === 'list') {
      if (owners.some(owner => owner.userId === userId)) throw new DomainError('forbidden')
      assertListRoom(tx, userId)
      tx.insert(listOwners).values({ listId: list.id, userId }).run()
      settleOwners(tx, wishesMarkedOn(tx, list.id))
      for (const owner of owners) {
        addNotice(tx, { userId: owner.userId, kind: 'list_joined', actorId: userId, title: list.title, listId: list.id })
      }
      // The invitation link stays for the next person. Whatever was sent to this person for
      // this list has nothing left to give: the send they just answered, or one that waited
      // while they came in through the link.
      tx.delete(invites).where(and(eq(invites.listId, list.id), eq(invites.kind, 'list'), eq(invites.sentTo, userId))).run()
      return { token: list.token }
    }

    if (!target) throw new DomainError('validation')
    const chosen = chosenFrom(onList, wishIds)
    if (found.invite.mode === 'copy') {
      const landing = targetListId(tx, userId, target)
      assertRoom(tx, landing.id, chosen.length)
      for (const wish of chosen) copyWishOnto(tx, wish, landing.id)
      if (sent) spend()
      else tx.insert(inviteUses).values({ inviteId: found.invite.id, userId }).run()
      return { token: landing.token }
    }

    // Someone who owns every chosen wish already has nothing to gain; the link stays for another.
    const arriving = chosen.filter(wish => !ownsWish(tx, wish.id, userId))
    if (arriving.length === 0) throw new DomainError('forbidden')
    const landing = targetListId(tx, userId, target)
    assertRoom(tx, landing.id, arriving.length)
    for (const wish of arriving) putOnList(tx, landing.id, wish.id)
    const [first] = arriving
    addNotice(tx, { userId: maker, kind: sent ? 'share_accepted' : 'joint_link_used', actorId: userId, title: first!.title, more: arriving.length - 1, wishId: first!.id })
    spend()
    return { token: landing.token }
  }, { behavior: 'immediate' })
}
