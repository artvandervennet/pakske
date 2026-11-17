import { and, asc, eq, inArray, min, ne } from 'drizzle-orm'
import type { AnonWish, BuyerWish, ListView, OwnerWish, WishView } from '../../shared/schemas/list'
import type { Db } from '../db/client'
import { listOwners, lists, listWishes, notes, purchases, users, wishOwners, wishes } from '../db/schema'
import { onListNow } from './placement'
import { livePublicWishes, toPublicWish } from './public-wishes'
import { mayUnlink } from './sharing'

// The one place that decides what a viewer gets for each wish on a list. The page renders what
// comes back and nothing else, so anything an owner must not learn has to stay out of here.

type WishRow = typeof wishes.$inferSelect

/** Who a wish belongs to, the earliest first, and whether a list other than this one shows it. */
type Joint = { owners: { id: number, name: string }[], elsewhere: boolean }

/**
 * Who owns each of these wishes and whether another list shows it. Read from owners and
 * placements only, never from purchases or notes, so whatever buyers or other owners did, these
 * come out the same.
 */
function jointDetails(db: Db, listId: number, wishIds: number[]): (wishId: number) => Joint {
  if (wishIds.length === 0) return () => ({ owners: [], elsewhere: false })
  const owners = db.select({ wishId: wishOwners.wishId, id: wishOwners.userId, name: users.displayName }).from(wishOwners)
    .innerJoin(users, eq(users.id, wishOwners.userId))
    .where(inArray(wishOwners.wishId, wishIds))
    .all()
  // Each owner's `standing` (see placement.ts), for all these wishes in one query.
  const standings = db.select({ wishId: listWishes.wishId, userId: listOwners.userId, lowest: min(listWishes.joinOrder) })
    .from(listWishes)
    .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .innerJoin(listOwners, eq(listOwners.listId, lists.id))
    .where(and(inArray(listWishes.wishId, wishIds), onListNow))
    .groupBy(listWishes.wishId, listOwners.userId)
    .all()
  const elsewhere = new Set(db.selectDistinct({ wishId: listWishes.wishId }).from(listWishes)
    .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .where(and(inArray(listWishes.wishId, wishIds), ne(listWishes.listId, listId), onListNow))
    .all()
    .map(row => row.wishId))

  const standing = (wishId: number, userId: number) =>
    standings.find(row => row.wishId === wishId && row.userId === userId)?.lowest ?? Number.POSITIVE_INFINITY
  return wishId => ({
    owners: owners
      .filter(owner => owner.wishId === wishId)
      .sort((a, b) => standing(wishId, a.id) - standing(wishId, b.id) || a.id - b.id)
      .map(({ id, name }) => ({ id, name })),
    elsewhere: elsewhere.has(wishId),
  })
}

/**
 * The names a row is tagged with: the wish's owners who don't own this list, since the list
 * already names its own, and never the viewer.
 */
function namesBeyondList(joint: (wishId: number) => Joint, listOwnerIds: Set<number>, viewerId: number | null) {
  return (wishId: number) => joint(wishId).owners
    .filter(owner => !listOwnerIds.has(owner.id) && owner.id !== viewerId)
    .map(owner => owner.name)
}

/** For a visitor who isn't logged in: the live wishes and whose they are, nothing else. */
function anonWishes(db: Db, listId: number, listOwnerIds: Set<number>): AnonWish[] {
  const live = livePublicWishes(db, listId)
  const sharedWith = namesBeyondList(jointDetails(db, listId, live.map(wish => wish.id)), listOwnerIds, null)
  return live.map(wish => ({ ...wish, role: 'anon', sharedWith: sharedWith(wish.id) }))
}

/**
 * For an owner of these wishes, which are all on the list now: with what the viewer bought
 * themselves. The purchases table is read for the viewer's own rows only, so nothing anyone else
 * did can change the answer.
 */
function ownerWishes(
  db: Db,
  rows: WishRow[],
  viewerId: number,
  joint: (wishId: number) => Joint,
  sharedWith: (wishId: number) => string[],
): OwnerWish[] {
  if (rows.length === 0) return []
  const own = db.select({ wishId: purchases.wishId, quantity: purchases.quantity }).from(purchases)
    .where(and(eq(purchases.userId, viewerId), inArray(purchases.wishId, rows.map(row => row.id))))
    .all()
  return rows.map((row) => {
    const { owners, elsewhere } = joint(row.id)
    return {
      ...toPublicWish(row),
      role: 'owner',
      mine: own.find(p => p.wishId === row.id)?.quantity ?? 0,
      sharedWith: sharedWith(row.id),
      coOwners: owners
        .filter(owner => owner.id !== viewerId)
        .map(owner => ({ ...owner, canUnlink: mayUnlink(db, row.id, viewerId, owner.id) })),
      alsoElsewhere: elsewhere,
    }
  })
}

/**
 * For a logged-in visitor who owns neither these wishes nor the list: who bought how many, and
 * the notes. A wish that is no longer on the list (taken off, deleted, or on a deleted list) stays
 * while someone has bought it, so the buyer can see it went and take back their purchase.
 */
function buyerWishes(
  db: Db,
  rows: { wish: WishRow, removed: boolean }[],
  viewerId: number,
  sharedWith: (wishId: number) => string[],
): BuyerWish[] {
  if (rows.length === 0) return []
  const ids = rows.map(row => row.wish.id)
  const bought = db
    .select({ wishId: purchases.wishId, userId: purchases.userId, name: users.displayName, quantity: purchases.quantity })
    .from(purchases)
    .innerJoin(users, eq(users.id, purchases.userId))
    .where(inArray(purchases.wishId, ids))
    .orderBy(asc(purchases.createdAt), asc(purchases.id))
    .all()
  const written = db
    .select({ id: notes.id, wishId: notes.wishId, userId: notes.userId, author: users.displayName, body: notes.body, createdAt: notes.createdAt })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.userId))
    .where(inArray(notes.wishId, ids))
    .orderBy(asc(notes.createdAt), asc(notes.id))
    .all()

  return rows.flatMap(({ wish: row, removed }) => {
    const wishPurchases = bought.filter(p => p.wishId === row.id)
    if (removed && wishPurchases.length === 0) return []
    return [{
      ...toPublicWish(row),
      role: 'buyer',
      sharedWith: sharedWith(row.id),
      removed,
      bought: wishPurchases.reduce((sum, p) => sum + p.quantity, 0),
      mine: wishPurchases.find(p => p.userId === viewerId)?.quantity ?? 0,
      purchases: wishPurchases.map(p => ({ name: p.name, quantity: p.quantity, mine: p.userId === viewerId })),
      notes: written.filter(n => n.wishId === row.id).map(n => ({
        id: n.id,
        author: n.author,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
        mine: n.userId === viewerId,
      })),
    }]
  })
}

/**
 * A list as this viewer may see it, or undefined when there is nothing for them. A deleted list
 * is undefined for its owners and for visitors who aren't logged in, the same as a token that
 * matches nothing, whatever was bought on it.
 */
export function getListView(db: Db, token: string, viewerId: number | null): ListView | undefined {
  const list = db.select().from(lists).where(eq(lists.token, token)).get()
  if (!list) return undefined

  const owners = db.select({ userId: listOwners.userId, name: users.displayName }).from(listOwners)
    .innerJoin(users, eq(users.id, listOwners.userId))
    .where(eq(listOwners.listId, list.id))
    .orderBy(asc(listOwners.addedAt), asc(listOwners.userId))
    .all()
  const viewerOwnsList = viewerId !== null && owners.some(owner => owner.userId === viewerId)
  const deleted = list.deletedAt !== null
  if (deleted && (viewerId === null || viewerOwnsList)) return undefined

  const view = { token: list.token, title: list.title, owners: owners.map(owner => owner.name), viewerOwnsList, deleted }
  const listOwnerIds = new Set(owners.map(owner => owner.userId))
  if (viewerId === null) return { ...view, wishes: anonWishes(db, list.id, listOwnerIds) }

  // Every wish the list has ever shown, with whether it is on the list now and whether the viewer
  // is one of its owners.
  const rows = db.select({ wish: wishes, removedAt: listWishes.removedAt, ownerId: wishOwners.userId }).from(listWishes)
    .innerJoin(wishes, eq(wishes.id, listWishes.wishId))
    .leftJoin(wishOwners, and(eq(wishOwners.wishId, wishes.id), eq(wishOwners.userId, viewerId)))
    .where(eq(listWishes.listId, list.id))
    .orderBy(asc(listWishes.position), asc(wishes.createdAt), asc(wishes.id))
    .all()
    .map(row => ({ wish: row.wish, owns: row.ownerId !== null, live: !deleted && row.removedAt === null && row.wish.deletedAt === null }))
  const owned = rows.filter(row => row.live && row.owns).map(row => row.wish)
  // Buyer rows go only to someone who owns neither the wish nor the list, so a wish that left the
  // list reads the same to both kinds of owner whatever buyers did: also to whoever stopped owning
  // it by taking it off, and for wishes deleted in step one, which kept their owners. A list's
  // owners own every wish it shows, so they lose nothing here.
  const forBuyers = rows
    .filter(row => !row.owns && !viewerOwnsList)
    .map(row => ({ wish: row.wish, removed: !row.live }))

  const joint = jointDetails(db, list.id, [...owned.map(wish => wish.id), ...forBuyers.map(row => row.wish.id)])
  const sharedWith = namesBeyondList(joint, listOwnerIds, viewerId)

  const byId = new Map<number, WishView>()
  for (const wish of ownerWishes(db, owned, viewerId, joint, sharedWith)) byId.set(wish.id, wish)
  for (const wish of buyerWishes(db, forBuyers, viewerId, sharedWith)) byId.set(wish.id, wish)
  // Back into the list's order, which is the same for everyone.
  return { ...view, wishes: rows.flatMap(row => byId.get(row.wish.id) ?? []) }
}
