import { randomInt } from 'node:crypto'
import { and, asc, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { SANTA_MIN_MEMBERS, type SantaGroupRow, type SantaView } from '../../shared/schemas/santa'
import type { Db } from '../db/client'
import { listOwners, lists, santaGroups, santaMembers, users, wishOwners } from '../db/schema'
import { DomainError } from './errors'
import { areFriends } from './friends'
import { listMyLists, ownedListId } from './lists'
import { addNotice } from './notices'
import { newListToken } from './tokens'

// Secret Santa: a group whose members each draw one other member to give something to. It stands
// beside the lists and changes nothing about them: a member puts one of their own lists in, and
// whoever draws them is handed its link, which opens for them as it does for anyone.
//
// The one secret here is who drew whom. `gives_to` is read for the member it belongs to and for
// nobody else, the person who runs the group included, so no answer of this file can be used to
// work out the rest of the draw. Nothing in this file looks at what anyone ticked on a list, and
// a test keeps it that way.

/** The most people one group holds. */
export const SANTA_MAX_MEMBERS = 50
/** How many groups a person can be in at once. */
export const SANTA_MAX_GROUPS = 20

type Group = typeof santaGroups.$inferSelect

function findGroup(db: Db, token: string): Group {
  const group = db.select().from(santaGroups).where(eq(santaGroups.token, token)).get()
  if (!group) throw new DomainError('not_found')
  return group
}

/**
 * The members in the order they joined. The first one runs the group: when that person leaves or
 * their account goes, the next one does, so a group is never stuck without anyone to start it.
 */
function membersOf(db: Db, groupId: number) {
  return db.select({ userId: santaMembers.userId, name: users.displayName, imageFile: users.imageFile, listId: santaMembers.listId, givesTo: santaMembers.givesTo })
    .from(santaMembers)
    .innerJoin(users, eq(users.id, santaMembers.userId))
    .where(eq(santaMembers.groupId, groupId))
    // Two who joined in the same millisecond: the one whose row was written first.
    .orderBy(asc(santaMembers.joinedAt), asc(sql`${santaMembers}.rowid`))
    .all()
}

const memberOf = (groupId: number, userId: number) => and(eq(santaMembers.groupId, groupId), eq(santaMembers.userId, userId))

/** Refuses when the person is in as many groups as one account may be. */
function assertGroupRoom(db: Db, userId: number): void {
  const { n } = db.select({ n: count() }).from(santaMembers).where(eq(santaMembers.userId, userId)).get()!
  if (n >= SANTA_MAX_GROUPS) throw new DomainError('santa_limit')
}

/** The list a member puts in: a live list of their own, or none. Someone else's is "not found". */
const chosenListId = (db: Db, userId: number, listToken: string | null) => (listToken === null ? null : ownedListId(db, userId, listToken))

/** A list a member put in, while it exists and is still theirs; null otherwise, and for none. */
function listOf(db: Db, userId: number, listId: number | null): { token: string, title: string } | null {
  if (listId === null) return null
  return db.select({ token: lists.token, title: lists.title }).from(lists)
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(and(eq(lists.id, listId), eq(listOwners.userId, userId), isNull(lists.deletedAt)))
    .get() ?? null
}

/** Makes a group with the person as its first member, who runs it. */
export function createGroup(db: Db, userId: number, title: string, listToken: string | null): { token: string } {
  return db.transaction((tx) => {
    assertGroupRoom(tx, userId)
    const listId = chosenListId(tx, userId, listToken)
    const group = tx.insert(santaGroups).values({ token: newListToken(), title }).returning().get()
    tx.insert(santaMembers).values({ groupId: group.id, userId, listId }).run()
    return { token: group.token }
  }, { behavior: 'immediate' })
}

/**
 * Joins a group by its link, with the list the person puts in. Whoever runs the group is told.
 * Once the names are drawn nobody joins: the draw would have to be done again, and everyone
 * would learn something from what changed. Someone who is in it already is left as they are.
 */
export function joinGroup(db: Db, userId: number, token: string, listToken: string | null): void {
  db.transaction((tx) => {
    const group = findGroup(tx, token)
    const members = membersOf(tx, group.id)
    if (members.some(member => member.userId === userId)) return
    if (group.drawnAt !== null) throw new DomainError('santa_drawn')
    if (members.length >= SANTA_MAX_MEMBERS) throw new DomainError('santa_full')
    assertGroupRoom(tx, userId)
    tx.insert(santaMembers).values({ groupId: group.id, userId, listId: chosenListId(tx, userId, listToken) }).run()
    const organiser = members[0]
    if (organiser) addNotice(tx, { userId: organiser.userId, kind: 'santa_joined', actorId: userId, title: group.title, santaGroupId: group.id })
  }, { behavior: 'immediate' })
}

/** The group and the asker's place in it. Someone who isn't in it gets "not found", like for a group that doesn't exist. */
function asMember(db: Db, userId: number, token: string) {
  const group = findGroup(db, token)
  const members = membersOf(db, group.id)
  const index = members.findIndex(member => member.userId === userId)
  if (index === -1) throw new DomainError('not_found')
  return { group, members, organiser: index === 0 }
}

/** The same for what only the person who runs the group may do. */
function asOrganiser(db: Db, userId: number, token: string) {
  const found = asMember(db, userId, token)
  if (!found.organiser) throw new DomainError('forbidden')
  return found
}

/** Which of their own lists a member puts in, or none. It can change after the draw too. */
export function setGroupList(db: Db, userId: number, token: string, listToken: string | null): void {
  db.transaction((tx) => {
    const { group } = asMember(tx, userId, token)
    tx.update(santaMembers).set({ listId: chosenListId(tx, userId, listToken) }).where(memberOf(group.id, userId)).run()
  }, { behavior: 'immediate' })
}

export function renameGroup(db: Db, userId: number, token: string, title: string): void {
  db.transaction((tx) => {
    const { group } = asOrganiser(tx, userId, token)
    tx.update(santaGroups).set({ title }).where(eq(santaGroups.id, group.id)).run()
  }, { behavior: 'immediate' })
}

/**
 * Leaves a group whose names aren't drawn yet. After the draw nobody leaves: someone would be
 * left with nobody to give to. A group its last member leaves is gone.
 */
export function leaveGroup(db: Db, userId: number, token: string): void {
  db.transaction((tx) => {
    const { group, members } = asMember(tx, userId, token)
    if (group.drawnAt !== null) throw new DomainError('santa_drawn')
    if (members.length === 1) tx.delete(santaGroups).where(eq(santaGroups.id, group.id)).run()
    else tx.delete(santaMembers).where(memberOf(group.id, userId)).run()
  }, { behavior: 'immediate' })
}

/** Whoever runs the group takes someone out before the draw. That person is told. */
export function removeMember(db: Db, userId: number, token: string, memberId: number): void {
  db.transaction((tx) => {
    const { group, members } = asOrganiser(tx, userId, token)
    if (group.drawnAt !== null) throw new DomainError('santa_drawn')
    if (!members.some(member => member.userId === memberId)) throw new DomainError('not_found')
    // Running a group is not a way out of it: the organiser leaves like anyone else.
    if (memberId === userId) throw new DomainError('forbidden')
    tx.delete(santaMembers).where(memberOf(group.id, memberId)).run()
    addNotice(tx, { userId: memberId, kind: 'santa_removed', actorId: userId, title: group.title, santaGroupId: group.id })
  }, { behavior: 'immediate' })
}

/** Whoever runs the group ends it, before or after the draw. What was said about it goes along. */
export function deleteGroup(db: Db, userId: number, token: string): void {
  db.transaction((tx) => {
    const { group } = asOrganiser(tx, userId, token)
    tx.delete(santaGroups).where(eq(santaGroups.id, group.id)).run()
  }, { behavior: 'immediate' })
}

/**
 * The same people in an order where nobody stands in their own place: who each of them draws.
 * Every such order is as likely as any other. A shuffle that leaves someone drawing themselves
 * is thrown away whole and done again; mending it by swapping two people would make some draws
 * likelier than others. The numbers come from the system's random source, never from anything
 * about the people or the group, so nothing can be worked out from what is known.
 */
export function drawOrder(ids: number[]): number[] {
  if (ids.length < 2) throw new DomainError('santa_too_few')
  for (;;) {
    const drawn = [...ids]
    for (let i = drawn.length - 1; i > 0; i--) {
      const j = randomInt(i + 1)
      ;[drawn[i], drawn[j]] = [drawn[j]!, drawn[i]!]
    }
    if (drawn.every((id, index) => id !== ids[index])) return drawn
  }
}

/**
 * Draws the names, once: every member gets one other member, and every member is drawn by one.
 * The other members are told that it happened, never what came out.
 */
export function drawNames(db: Db, userId: number, token: string): void {
  db.transaction((tx) => {
    const { group, members } = asOrganiser(tx, userId, token)
    if (group.drawnAt !== null) throw new DomainError('santa_drawn')
    if (members.length < SANTA_MIN_MEMBERS) throw new DomainError('santa_too_few')
    const ids = members.map(member => member.userId)
    const drawn = drawOrder(ids)
    ids.forEach((id, index) => {
      tx.update(santaMembers).set({ givesTo: drawn[index]! }).where(memberOf(group.id, id)).run()
    })
    tx.update(santaGroups).set({ drawnAt: new Date() }).where(eq(santaGroups.id, group.id)).run()
    for (const id of ids) {
      if (id !== userId) addNotice(tx, { userId: id, kind: 'santa_drawn', actorId: userId, title: group.title, santaGroupId: group.id })
    }
  }, { behavior: 'immediate' })
}

/**
 * A group as this person gets it, or undefined when no group has the token. A member gets the
 * members and, of the draw, their own name alone. Anyone else gets what they need to decide
 * whether to join: its name, who runs it and how many are in.
 */
export function getGroup(db: Db, viewerId: number, token: string): SantaView | undefined {
  const group = db.select().from(santaGroups).where(eq(santaGroups.token, token)).get()
  if (!group) return undefined
  const members = membersOf(db, group.id)
  const me = members.find(member => member.userId === viewerId)
  const mine = listMyLists(db, viewerId)
  if (!me) {
    return {
      role: 'guest',
      title: group.title,
      organiser: members[0]?.name ?? '',
      members: members.length,
      state: group.drawnAt !== null ? 'drawn' : members.length >= SANTA_MAX_MEMBERS ? 'full' : 'open',
      mine,
    }
  }
  // A profile picture goes to friends only, here as everywhere.
  const pictureOf = (member: { userId: number, imageFile: string | null }) =>
    member.imageFile && areFriends(db, viewerId, member.userId) ? `/uploads/${member.imageFile}` : null
  const drew = me.givesTo === null ? undefined : members.find(member => member.userId === me.givesTo)
  return {
    role: 'member',
    token: group.token,
    title: group.title,
    drawn: group.drawnAt !== null,
    organiser: members[0]!.userId === viewerId,
    members: members.map((member, index) => ({
      id: member.userId,
      name: member.name,
      picture: pictureOf(member),
      you: member.userId === viewerId,
      organiser: index === 0,
      hasList: listOf(db, member.userId, member.listId) !== null,
    })),
    lists: mine.lists,
    list: listOf(db, viewerId, me.listId)?.token ?? null,
    pick: drew ? { id: drew.userId, name: drew.name, picture: pictureOf(drew), list: listOf(db, drew.userId, drew.listId) } : null,
  }
}

/** The groups the person is in, the one they joined last first. */
export function listGroups(db: Db, userId: number): SantaGroupRow[] {
  return db.select({ group: santaGroups }).from(santaMembers)
    .innerJoin(santaGroups, eq(santaGroups.id, santaMembers.groupId))
    .where(eq(santaMembers.userId, userId))
    .orderBy(desc(santaMembers.joinedAt), desc(santaGroups.id))
    .all()
    .map(({ group }) => {
      const members = membersOf(db, group.id)
      return { token: group.token, title: group.title, members: members.length, drawn: group.drawnAt !== null, organiser: members[0]?.userId === userId }
    })
}

/** Everyone whose name this person drew, in whichever group. */
const drawnBy = (userId: number) => and(eq(santaMembers.userId, userId), isNotNull(santaMembers.givesTo))

/**
 * Did this person draw one of a wish's owners? What they give that person is then given without
 * their name unless they say otherwise, so the other members who open the same list can't read
 * the draw from it.
 */
export function drewAnOwnerOf(db: Db, userId: number, wishId: number): boolean {
  return db.select({ userId: wishOwners.userId }).from(santaMembers)
    .innerJoin(wishOwners, eq(wishOwners.userId, santaMembers.givesTo))
    .where(and(drawnBy(userId), eq(wishOwners.wishId, wishId)))
    .get() !== undefined
}

/**
 * The owners of a list whose name this person drew, by display name, in the order they joined
 * the list. The list's page tells the person, since what they tick there is given differently.
 */
export function drawnOwnersOf(db: Db, userId: number, listToken: string): string[] {
  const drew = new Set(db.select({ givesTo: santaMembers.givesTo }).from(santaMembers).where(drawnBy(userId)).all().map(row => row.givesTo))
  if (drew.size === 0) return []
  return db.select({ userId: listOwners.userId, name: users.displayName }).from(listOwners)
    .innerJoin(lists, eq(lists.id, listOwners.listId))
    .innerJoin(users, eq(users.id, listOwners.userId))
    .where(and(eq(lists.token, listToken), isNull(lists.deletedAt)))
    .orderBy(asc(listOwners.addedAt), asc(listOwners.userId))
    .all()
    .filter(owner => drew.has(owner.userId))
    .map(owner => owner.name)
}

/**
 * Takes an account out of every group, before its row goes. Where the names were drawn, whoever
 * drew this person takes over the name this person had drawn, so everyone left still gives to
 * someone and is still given to by someone. Only when those two are the same person is there
 * nobody to pass on. A group nobody is left in is gone. Runs in the caller's transaction.
 */
export function leaveEveryGroup(db: Db, userId: number): void {
  const mine = db.select({ groupId: santaMembers.groupId, givesTo: santaMembers.givesTo }).from(santaMembers)
    .where(eq(santaMembers.userId, userId)).all()
  for (const { groupId, givesTo } of mine) {
    const giver = db.select({ userId: santaMembers.userId }).from(santaMembers)
      .where(and(eq(santaMembers.groupId, groupId), eq(santaMembers.givesTo, userId))).get()
    if (giver) {
      db.update(santaMembers).set({ givesTo: givesTo === giver.userId ? null : givesTo }).where(memberOf(groupId, giver.userId)).run()
    }
    db.delete(santaMembers).where(memberOf(groupId, userId)).run()
    const { left } = db.select({ left: count() }).from(santaMembers).where(eq(santaMembers.groupId, groupId)).get()!
    if (left === 0) db.delete(santaGroups).where(eq(santaGroups.id, groupId)).run()
  }
}
