import { openDb, type Db } from '../server/db/client'
import { createItem } from '../server/domain/items'
import { createUser } from '../server/domain/users'

export function makeDb(): Db {
  return openDb(':memory:')
}

export function addUser(db: Db, username: string) {
  return createUser(db, {
    email: `${username}@example.test`,
    username,
    displayName: username[0]!.toUpperCase() + username.slice(1),
    passwordHash: 'not-a-real-hash',
  })
}

export function addItem(db: Db, ownerId: number, title: string, quantity: number | null = 1) {
  return createItem(db, ownerId, { title, description: null, url: null, quantity })
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
