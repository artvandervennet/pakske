import { count, eq } from 'drizzle-orm'
import type { ProfileInput } from '../../shared/schemas/input'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { DomainError } from './errors'

// Names that are, or could become, a path of the site.
const RESERVED_USERNAMES = new Set([
  'admin', 'api', 'u', 'me', 'en', 'nl', 'login', 'logout', 'register', 'settings', 'uploads',
  'account', 'help', 'about', 'new', 'edit', 'null', 'undefined', 'wishlist', 'verlanglijst',
])

export interface NewUser {
  email: string
  username: string
  displayName: string
  passwordHash: string
}

export function createUser(db: Db, input: NewUser, options: { maxUsers?: number } = {}) {
  return db.transaction((tx) => {
    if (options.maxUsers !== undefined) {
      const { total } = tx.select({ total: count() }).from(users).get()!
      if (total >= options.maxUsers) throw new DomainError('registration_closed')
    }
    if (RESERVED_USERNAMES.has(input.username)) throw new DomainError('username_taken')
    if (tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get()) throw new DomainError('email_taken')
    if (tx.select({ id: users.id }).from(users).where(eq(users.username, input.username)).get()) throw new DomainError('username_taken')
    return tx.insert(users).values(input).returning().get()
  }, { behavior: 'immediate' })
}

export function findUserByEmail(db: Db, email: string) {
  return db.select().from(users).where(eq(users.email, email)).get()
}

export function findUserById(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get()
}

export function updateProfile(db: Db, userId: number, input: ProfileInput) {
  db.update(users).set({ displayName: input.displayName, listIntro: input.listIntro }).where(eq(users.id, userId)).run()
}

export function setPasswordHash(db: Db, userId: number, passwordHash: string) {
  db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run()
}
