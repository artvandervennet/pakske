import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/** SQLite keeps its journal beside the database, under the same name with these ends. */
const ENDS = ['', '-wal', '-shm']

/**
 * The database file in `dir`: pakske.db. A database from when the site was called wishlist takes
 * the new name first, with its journal, so the data stays. Call it before anything opens the file.
 */
export function databaseFile(dir: string): string {
  const file = join(dir, 'pakske.db')
  const old = join(dir, 'wishlist.db')
  if (!existsSync(file) && existsSync(old)) {
    // The journal first: a database seen without its journal would miss the latest writes.
    for (const end of ENDS.toReversed()) {
      if (existsSync(old + end)) renameSync(old + end, file + end)
    }
  }
  return file
}
