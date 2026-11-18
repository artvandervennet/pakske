import { count, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { DomainError } from './errors'

export interface NewUser {
  email: string
  displayName: string
  /** Null for an account made with Google: it logs in there. */
  passwordHash: string | null
  googleSub?: string | null
}

/** What Google says about the person logging in (its userinfo answer, trimmed to what we use). */
export interface GoogleProfile {
  sub: string
  email: string
  emailVerified: boolean
  name?: string | null
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

/**
 * The account for someone coming back from Google: the one that has their Google id, or a new
 * one without a password. An account that already has their address but not their Google id is
 * not entered: anyone can make an account with any address here, so that account could be
 * someone else's. Its owner logs in with its password and links Google under Settings.
 */
export function logInWithGoogle(db: Db, profile: GoogleProfile, options: { maxUsers?: number } = {}) {
  const known = db.select().from(users).where(eq(users.googleSub, profile.sub)).get()
  if (known) return known
  if (!profile.emailVerified) throw new DomainError('google_unverified')
  const email = profile.email.trim().toLowerCase()
  if (findUserByEmail(db, email)) throw new DomainError('google_email_taken')
  const displayName = (profile.name?.trim() || email.split('@')[0]!).slice(0, 60)
  return createUser(db, { email, displayName, passwordHash: null, googleSub: profile.sub }, options)
}

/** Lets an account log in with this Google account from now on. */
export function linkGoogle(db: Db, userId: number, sub: string): void {
  db.transaction((tx) => {
    const holder = tx.select({ id: users.id }).from(users).where(eq(users.googleSub, sub)).get()
    if (holder && holder.id !== userId) throw new DomainError('google_taken')
    tx.update(users).set({ googleSub: sub }).where(eq(users.id, userId)).run()
  }, { behavior: 'immediate' })
}

/** Stops logging in with Google; only for an account that has a password to log in with instead. */
export function unlinkGoogle(db: Db, userId: number): void {
  db.transaction((tx) => {
    const user = tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).get()
    if (!user?.passwordHash) throw new DomainError('password_needed')
    tx.update(users).set({ googleSub: null }).where(eq(users.id, userId)).run()
  }, { behavior: 'immediate' })
}
