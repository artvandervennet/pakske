import { sql } from 'drizzle-orm'

export default defineEventHandler(() => {
  useDb().run(sql`select 1`)
  return { ok: true }
})
