import { asc, eq } from 'drizzle-orm'
import { openDb, type Db } from '../server/db/client'
import { purchases } from '../server/db/schema'
import { createList } from '../server/domain/lists'
import { createUser } from '../server/domain/users'
import { addWish } from '../server/domain/wishes'
import { wishInput } from '../shared/schemas/input'

export function makeDb(): Db {
  return openDb(':memory:')
}

export function addUser(db: Db, name: string) {
  return createUser(db, {
    email: `${name}@example.test`,
    displayName: name[0]!.toUpperCase() + name.slice(1),
    passwordHash: 'not-a-real-hash',
  })
}

/** The code of the DomainError a function throws, or undefined when it doesn't throw. */
export function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  }
  catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
  return undefined
}

export function addList(db: Db, userId: number, title = 'Kerst'): string {
  return createList(db, userId, title).token
}

export function addWishTo(db: Db, userId: number, token: string, title: string, quantity: number | null = 1) {
  return addWish(db, userId, token, wishInput.parse({ title, quantity }))
}

/** What the purchases table holds for a wish, read straight from the table. */
export function purchaseRows(db: Db, wishId: number): { userId: number, quantity: number }[] {
  return db.select({ userId: purchases.userId, quantity: purchases.quantity }).from(purchases)
    .where(eq(purchases.wishId, wishId)).orderBy(asc(purchases.userId)).all()
}
