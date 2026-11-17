import { openDb, type Db } from '../server/db/client'
import { createUser } from '../server/domain/users'

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
