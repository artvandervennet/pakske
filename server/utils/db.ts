import { join } from 'node:path'
import { openDb, type Db } from '../db/client'

let db: Db | undefined

/** The one database connection of this server. Opens the file and runs migrations on first use. */
export function useDb(): Db {
  db ??= openDb(join(useRuntimeConfig().dataDir, 'wishlist.db'))
  return db
}
