import { count, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { DomainError } from './errors'
import { insertList } from './lists'

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
  db.update(users).set({ displayName }).where(eq(users.id, userId)).run()
}

export function setPasswordHash(db: Db, userId: number, passwordHash: string) {
  db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run()
}
