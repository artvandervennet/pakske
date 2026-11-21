import { importInput } from '../../../../../shared/schemas/input'
import { addWishes } from '../../../../domain/wishes'

const WINDOW = 10 * 60 * 1000

// The wishes chosen from what an import found, put on a list of the person's own: all of them
// or none. Their pictures are fetched afterwards, for as long as the request may wait; the rest
// come in later. Ten times in ten minutes, since each is up to a hundred pictures to fetch.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const { items } = await readInput(event, importInput)
  const key = `import-add:${user.id}`
  if (isLimited(key, 10)) fail(429, 'rate_limited')
  countHit(key, WINDOW)
  const db = useDb()
  const added = domain(() => addWishes(db, user.id, token, items))
  await coverImported(db, user.id, token, added.map((wish, at) => ({ wishId: wish.id, url: items[at]!.url, image: items[at]!.image })))
  setResponseStatus(event, 201)
  return { added: added.length }
})
