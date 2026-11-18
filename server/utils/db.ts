import { openDb, type Db } from '../db/client'
import { databaseFile } from '../db/file'

let db: Db | undefined

/** The one database connection of this server. Opens the file and runs migrations on first use. */
export function useDb(): Db {
  db ??= openDb(databaseFile(useRuntimeConfig().dataDir))
  return db
}
