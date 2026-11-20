import { exportAccount } from '../../domain/export'

const WINDOW = 60 * 60 * 1000

// The copy of everything the site keeps about the person, as a file their browser saves: the
// download under Settings, and what the privacy page means by "a copy of your data".
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const key = `export:${user.id}`
  if (isLimited(key, 10)) fail(429, 'rate_limited')
  countHit(key, WINDOW)

  const copy = domain(() => exportAccount(useDb(), user.id))
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="pakske.json"')
  return JSON.stringify(copy, null, 2)
})
