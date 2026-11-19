import { relinkList } from '../../../domain/lists'

const HOUR = 60 * 60 * 1000

// Gives a list of the person's own a new address. The one it had stops opening it for everyone;
// the page goes on at the address this answers with. Anything else is "not found", so a
// stranger learns nothing about the list.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  // Every new link makes everyone else's stop working; ten an hour is more than anyone needs.
  const key = `relink:${user.id}`
  if (isLimited(key, 10)) fail(429, 'rate_limited')
  const list = domain(() => relinkList(useDb(), user.id, token))
  countHit(key, HOUR)
  return list
})
