import { count, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { DomainError } from './errors'

export interface NewUser {
  email: string
  displayName: string
  passwordHash: string
}

export function createUser(db: Db, input: NewUser, options: { maxUsers?: number } = {}) {
  return db.transaction((tx) => {
    if (options.maxUsers !== undefined) {
      const { total } = tx.select({ total: count() }).from(users).get()!
      if (total >= options.maxUsers) throw new DomainError('registration_closed')
    }
    if (tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get()) throw new DomainError('email_taken')
    return tx.insert(users).values(input).returning().get()
  }, { behavior: 'immediate' })
}

export function findUserByEmail(db: Db, email: string) {
  return db.select().from(users).where(eq(users.email, email)).get()
}

export function findUserById(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get()
}

export function updateDisplayName(db: Db, userId: number, displayName: string): void {
  db.update(users).set({ displayName }).where(eq(users.id, userId)).run()
}

export function setPasswordHash(db: Db, userId: number, passwordHash: string) {
  db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run()
}
