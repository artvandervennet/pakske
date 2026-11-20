import { santaInput } from '../../../shared/schemas/input'
import { createGroup } from '../../domain/santa'

const HOUR = 60 * 60 * 1000

// A new Secret Santa group, with its maker as the first member.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readInput(event, santaInput)
  // A group that is made and deleted leaves nothing behind, so the count of groups alone
  // wouldn't stop someone doing that all day.
  const key = `santa-group:${user.id}`
  if (isLimited(key, 20)) fail(429, 'rate_limited')
  countHit(key, HOUR)
  const group = domain(() => createGroup(useDb(), user.id, input.title, input.list))
  setResponseStatus(event, 201)
  return group
})
