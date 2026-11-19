import { makeFriendLink } from '../../../domain/friends'

const HOUR = 60 * 60 * 1000

// A link to send to one person, who becomes a friend by opening it and saying yes.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const key = `friend-link:${user.id}`
  if (isLimited(key, 10)) fail(429, 'rate_limited')
  countHit(key, HOUR)
  const link = makeFriendLink(useDb(), user.id)
  setResponseStatus(event, 201)
  return link
})
