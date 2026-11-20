import { and, count, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { linkChanges, notices, users, wishLinks } from '../db/schema'
import { DomainError } from './errors'
import { insertList, listsOwnedAlone, removeList } from './lists'
import { leaveEveryGroup } from './santa'
import { dismissNotice, unusedImages } from './undo'

export interface NewUser {
  email: string
  displayName: string
  /** Only for an account from before Firebase; Firebase holds every newer password. */
  passwordHash: string | null
  firebaseUid?: string | null
  googleSub?: string | null
}

/** The language an account is made in: the page's, for what the site names on the person's behalf. */
export type AccountLocale = 'nl' | 'en'

/** The language of a page on this site, from its path: English lives under /en, Dutch has no prefix. */
export function localeOfPath(path: string): AccountLocale {
  return /^\/en(?:[/?#]|$)/.test(path) ? 'en' : 'nl'
}

// Nobody should land on an empty home page and have to work out that a list comes first.
const FIRST_LIST_TITLE: Record<AccountLocale, string> = { nl: 'Verlanglijst', en: 'Wishlist' }

/** Makes the account and its first list, named in the language the account is made in. */
export function createUser(db: Db, input: NewUser, options: { maxUsers?: number, locale?: AccountLocale } = {}) {
  return db.transaction((tx) => {
    if (options.maxUsers !== undefined) {
      const { total } = tx.select({ total: count() }).from(users).get()!
      if (total >= options.maxUsers) throw new DomainError('registration_closed')
    }
    if (tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get()) throw new DomainError('email_taken')
    const user = tx.insert(users).values(input).returning().get()
    // A new account has no lists, so there is room for this one without asking.
    insertList(tx, user.id, FIRST_LIST_TITLE[options.locale ?? 'nl'])
    return user
  }, { behavior: 'immediate' })
}

export function findUserByEmail(db: Db, email: string) {
  return db.select().from(users).where(eq(users.email, email)).get()
}

export function findUserById(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get()
}

/**
 * Does a login cookie still belong to this account? An id alone isn't enough: after a restore
 * the same id can belong to someone else. The moment the account was made tells them apart.
 * A cookie from before that moment was stored in it doesn't belong to anyone.
 */
export function sessionBelongsTo(
  session: { id: number, createdAt?: number },
  account: { id: number, createdAt: Date } | undefined,
): boolean {
  return account !== undefined
    && account.id === session.id
    && account.createdAt.getTime() === session.createdAt
}

export function updateDisplayName(db: Db, userId: number, displayName: string): void {
  updateProfile(db, userId, { displayName })
}

/** Changes what is given of the profile, leaves the rest, and answers the account as it is now. */
export function updateProfile(db: Db, userId: number, change: { displayName?: string, anonymousDefault?: boolean }) {
  const given = Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined))
  const user = db.update(users).set(given).where(eq(users.id, userId)).returning().get()
  if (!user) throw new DomainError('not_found')
  return user
}

export function setPasswordHash(db: Db, userId: number, passwordHash: string) {
  db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run()
}

/**
 * Sets or clears the person's profile picture. Returns the file it replaced, for the caller to
 * remove from disk: nothing else ever points at a profile picture.
 */
export function setPicture(db: Db, userId: number, imageFile: string | null): { unused: string[] } {
  return db.transaction((tx) => {
    const before = tx.select({ imageFile: users.imageFile }).from(users).where(eq(users.id, userId)).get()
    if (!before) throw new DomainError('not_found')
    tx.update(users).set({ imageFile }).where(eq(users.id, userId)).run()
    return { unused: before.imageFile && before.imageFile !== imageFile ? [before.imageFile] : [] }
  }, { behavior: 'immediate' })
}

/**
 * Removes an account and what it made. A list it owns alone is deleted as if it deleted that
 * list itself: whoever was getting something from it keeps seeing that for a while, and then the
 * list is erased with its wishes (server/domain/purge.ts). A list it shares is the other owners'
 * from then on, with its wishes. What it wrote on other people's wishes, and to the owners of
 * other people's lists, stays there written by nobody, until that wish or list goes. Then the
 * account's row goes, and the database does the rest for whatever hangs on that row. Nothing
 * keeps the address or the name, so an account made later with the same address starts with
 * nothing of this one. Returns the pictures nothing points at any more, for the caller to remove.
 */
export function deleteUser(db: Db, userId: number): { unused: string[] } {
  return db.transaction((tx) => {
    const unused: string[] = []
    // Their profile picture goes with them.
    const own = tx.select({ imageFile: users.imageFile }).from(users).where(eq(users.id, userId)).get()
    if (own?.imageFile) unused.push(own.imageFile)
    // Their notices go as if they closed each one: a link that nobody can undo any more stops
    // remembering, and the picture it kept may be free.
    for (const notice of tx.select({ id: notices.id }).from(notices).where(eq(notices.userId, userId)).all()) {
      unused.push(...dismissNotice(tx, userId, notice.id).unused)
    }

    // The links they made go with their row, and so does what those remembered for an undo.
    const kept = tx.select({ before: linkChanges.before }).from(linkChanges)
      .innerJoin(wishLinks, eq(wishLinks.id, linkChanges.linkId))
      .where(and(eq(wishLinks.userId, userId), eq(linkChanges.field, 'imageFile')))
      .all()
      .map(row => JSON.parse(row.before) as string | null)
    // A Secret Santa they were in goes on without them, and nobody is left giving to no one.
    leaveEveryGroup(tx, userId)
    // The lists that are theirs alone go with them. Their wishes keep their pictures until the
    // purge erases them: a buyer may still be looking at one.
    for (const listId of listsOwnedAlone(tx, userId)) removeList(tx, listId)
    // With the row go the account's places among the owners of the lists it shared, and of the
    // wishes on them, which stay with the other owners.
    tx.delete(users).where(eq(users.id, userId)).run()
    return { unused: [...unused, ...unusedImages(tx, kept)] }
  }, { behavior: 'immediate' })
}
