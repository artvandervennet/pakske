import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { GivenGroup, GivenWish } from '../../shared/schemas/list'
import { keptForBuyers, leftListAt } from '../../shared/utils/kept-for-buyers'
import type { Db } from '../db/client'
import { listOwners, listVisits, lists, listWishes, purchases, users, wishOwners, wishes } from '../db/schema'
import { DomainError } from './errors'
import { shownListIds } from './friends'
import { wishOnList } from './placement'
import { drewAnOwnerOf } from './santa'

/**
 * Sets how many of a wish this person is buying. An owner of the wish is treated like any buyer.
 *
 * The whole check runs in one synchronous transaction with no `await` in it, so two buyers who
 * click at the same moment are handled one after the other and can't both take the last one.
 *
 * Only an increase is checked. Lowering always works, also when the owner has since lowered
 * the amount, taken the wish off this list, or deleted the wish or the list. It also works
 * through an address the list had before a new link, but only for someone who has a purchase
 * on the wish: for anyone else that address is "not found", like one that never existed.
 *
 * `anonymous` says whether the other buyers see "someone" instead of this person's name. Left
 * out, a purchase keeps what it had, and a new one goes by what the buyer chose in Settings
 * ("Standaard anoniem geven"): with the name, unless they turned that on. One thing overrules
 * that: a new purchase for someone whose name the buyer drew in a Secret Santa is without the
 * buyer's name, or the other members who open that list could read the draw from it.
 */
export function setPurchase(db: Db, token: string, wishId: number, userId: number, quantity: number, anonymous?: boolean): void {
  if (!Number.isInteger(quantity) || quantity < 1) throw new DomainError('validation')

  db.transaction((tx) => {
    const { wish, live, old } = wishOnList(tx, token, wishId, { old: true })
    const mine = tx.select().from(purchases)
      .where(and(eq(purchases.wishId, wishId), eq(purchases.userId, userId))).get()
    // Decided by the person's own row alone, so it says nothing about anyone else.
    if (old && !mine) throw new DomainError('not_found')

    if (quantity > (mine?.quantity ?? 0)) {
      // Before anything about other purchases is read, so the answer is the same whether or
      // not anyone bought the wish: an owner can't use it to find out.
      if (!live) throw new DomainError('wish_removed')
      if (wish.quantity !== null) {
        const { others } = tx
          .select({ others: sql<number>`coalesce(sum(${purchases.quantity}), 0)` })
          .from(purchases)
          .where(and(eq(purchases.wishId, wishId), ne(purchases.userId, userId)))
          .get()!
        if (others + quantity > wish.quantity) throw new DomainError('quantity_exceeded')
      }
    }

    if (mine) {
      tx.update(purchases).set({ quantity, anonymous: anonymous ?? mine.anonymous, updatedAt: new Date() }).where(eq(purchases.id, mine.id)).run()
      return
    }
    const buyer = tx.select({ anonymousDefault: users.anonymousDefault }).from(users).where(eq(users.id, userId)).get()
    const unnamed = anonymous ?? ((buyer?.anonymousDefault ?? false) || drewAnOwnerOf(tx, userId, wishId))
    tx.insert(purchases).values({ wishId, userId, quantity, anonymous: unnamed }).run()
  }, { behavior: 'immediate' })
}

/**
 * Removing something that isn't there is not an error. Except through an address the list had
 * before a new link: there, someone with nothing to remove gets "not found", like for an address
 * that never existed, or they could go on asking which wishes the list has.
 */
export function removePurchase(db: Db, token: string, wishId: number, userId: number): void {
  db.transaction((tx) => {
    const { old } = wishOnList(tx, token, wishId, { old: true })
    const removed = tx.delete(purchases).where(and(eq(purchases.wishId, wishId), eq(purchases.userId, userId)))
      .returning({ id: purchases.id }).get()
    if (old && !removed) throw new DomainError('not_found')
  }, { behavior: 'immediate' })
}

/**
 * Everything this person gives to other people, per person it is for, so they don't have to
 * remember it: the people they ticked something for last first, and under each what they ticked,
 * the last first.
 *
 * It is what the lists on their page would show them of their own, and nothing more. A purchase
 * counts when a list they opened, or one a friend shows them, has the wish: the row then links
 * to that list, an address they have already. A wish on no such list is left out, whatever
 * other list shows it, or the row would hand them a list they never had the link of. So is a
 * wish they own themselves (that tick says "I have this", not "I give this"), and a wish that
 * left its list longer ago than a buyer keeps seeing it there (`keptForBuyers`).
 *
 * The purchases table is read for the person's own rows only, so nothing anyone else ticked can
 * change the answer.
 */
export function listGiven(db: Db, userId: number, now = new Date()): GivenGroup[] {
  const ticked = db.select({ wish: wishes, mine: purchases.quantity, tickedAt: purchases.createdAt, purchaseId: purchases.id })
    .from(purchases)
    .innerJoin(wishes, eq(wishes.id, purchases.wishId))
    .where(eq(purchases.userId, userId))
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .all()
  if (ticked.length === 0) return []
  const wishIds = ticked.map(row => row.wish.id)

  const owned = new Set(db.select({ wishId: wishOwners.wishId }).from(wishOwners)
    .where(and(eq(wishOwners.userId, userId), inArray(wishOwners.wishId, wishIds))).all().map(row => row.wishId))
  const ownLists = new Set(db.select({ listId: listOwners.listId }).from(listOwners)
    .where(eq(listOwners.userId, userId)).all().map(row => row.listId))
  // The lists on the person's page, with when they last opened each. A list a friend shows them
  // has no visit; it ranks after the ones they opened.
  const openedAt = new Map(db.select({ listId: listVisits.listId, openedAt: listVisits.openedAt }).from(listVisits)
    .where(eq(listVisits.userId, userId)).all().map(row => [row.listId, row.openedAt.getTime()]))
  for (const listId of shownListIds(db, userId)) if (!openedAt.has(listId)) openedAt.set(listId, 0)

  const placements = db.select({ wishId: listWishes.wishId, removedAt: listWishes.removedAt, clearedAt: listWishes.clearedAt, list: lists })
    .from(listWishes)
    .innerJoin(lists, eq(lists.id, listWishes.listId))
    .where(inArray(listWishes.wishId, wishIds))
    .all()
    .filter(row => openedAt.has(row.list.id) && !ownLists.has(row.list.id))

  const ownersOf = new Map<number, { id: number, name: string }[]>()
  /** A list's owners, in the order they joined. */
  const listOwnersOf = (listId: number) => {
    if (!ownersOf.has(listId)) {
      ownersOf.set(listId, db.select({ id: users.id, name: users.displayName }).from(listOwners)
        .innerJoin(users, eq(users.id, listOwners.userId))
        .where(eq(listOwners.listId, listId))
        .orderBy(asc(listOwners.addedAt), asc(listOwners.userId))
        .all())
    }
    return ownersOf.get(listId)!
  }

  const groups = new Map<string, GivenGroup>()
  for (const { wish, mine } of ticked) {
    if (owned.has(wish.id)) continue
    // The list to show it on: one that has it now before one it left, and of those the one the
    // person opened last.
    const place = placements
      .filter(row => row.wishId === wish.id)
      .map((row) => {
        const leftAt = leftListAt(row.removedAt, wish.deletedAt, row.list.deletedAt)
        return { ...row, live: leftAt === null, kept: leftAt === null || keptForBuyers(leftAt, row.clearedAt, now) }
      })
      .filter(row => row.kept)
      .sort((a, b) => Number(b.live) - Number(a.live) || openedAt.get(b.list.id)! - openedAt.get(a.list.id)! || b.list.id - a.list.id)[0]
    if (!place) continue

    // Who it is for: the owners of that list, and then whoever else the wish belongs to through
    // a list of their own. A wish that left the list is nobody's any more; it was the list's owners'.
    const people = [...listOwnersOf(place.list.id)]
    if (place.live) {
      const others = db.select({ id: users.id, name: users.displayName }).from(wishOwners)
        .innerJoin(users, eq(users.id, wishOwners.userId))
        .where(eq(wishOwners.wishId, wish.id))
        .orderBy(asc(wishOwners.addedAt), asc(wishOwners.userId))
        .all()
      people.push(...others.filter(other => !people.some(person => person.id === other.id)))
    }

    // By id, so two people with one name stay apart.
    const key = people.map(person => person.id).sort((a, b) => a - b).join(' ')
    if (!groups.has(key)) groups.set(key, { names: people.map(person => person.name), wishes: [] })
    const row: GivenWish = {
      id: wish.id,
      title: wish.title,
      image: wish.imageFile ? `/uploads/${wish.imageFile}` : null,
      mine,
      quantity: wish.quantity,
      token: place.list.token,
      listTitle: place.list.title,
      removed: !place.live,
    }
    groups.get(key)!.wishes.push(row)
  }
  // A Map keeps the order its keys came in: the group of the last tick first.
  return [...groups.values()]
}
