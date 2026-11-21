import { importReadInput } from '../../../shared/schemas/input'

const WINDOW = 10 * 60 * 1000
/** Who has a paste being read right now: one at a time per account. */
const reading = new Set<number>()

// What an import starts with: the links someone pasted, read at their shops. The answer is what
// was found; nothing is on a list yet. Each read is up to a hundred requests from this server,
// so an account gets five in ten minutes, and a paste without a link isn't counted.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { text } = await readInput(event, importReadInput)
  if (linksIn(text).length === 0) return readImport(text)
  const key = `import:${user.id}`
  if (reading.has(user.id) || isLimited(key, 5)) fail(429, 'rate_limited')
  countHit(key, WINDOW)
  reading.add(user.id)
  try {
    return await readImport(text)
  }
  finally {
    reading.delete(user.id)
  }
})
