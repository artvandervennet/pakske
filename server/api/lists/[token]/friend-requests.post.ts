import { friendRequestInput } from '../../../../shared/schemas/input'
import { askFriend } from '../../../domain/friends'

const HOUR = 60 * 60 * 1000

// Asks an owner of this list to be friends. The list is how the asker knows them, so there is no
// way to ask someone whose list one can't open.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const key = `friend-request:${user.id}`
  if (isLimited(key, 20)) fail(429, 'rate_limited')
  const input = await readInput(event, friendRequestInput)
  countHit(key, HOUR)
  return { state: domain(() => askFriend(useDb(), user.id, token, input.owner)) }
})
