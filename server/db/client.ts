import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

/** Opens the SQLite file (or ':memory:') and brings it up to the latest migration. */
export function openDb(file: string, migrationsFolder = resolve('server/db/migrations')): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  // Foreign keys stay off while migrating. A migration that rebuilds a table drops the old one,
  // and with them on, that drop would delete every row that points at it (on delete cascade).
  // The PRAGMA in such a migration does nothing: the migrations run inside one transaction.
  sqlite.pragma('foreign_keys = OFF')
  migrate(db, { migrationsFolder })
  const broken = sqlite.pragma('foreign_key_check') as unknown[]
  if (broken.length) throw new Error(`The migrations left ${broken.length} rows pointing at nothing`)
  sqlite.pragma('foreign_keys = ON')
  return db
}
