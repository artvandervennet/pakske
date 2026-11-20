import { getGroup } from '../../../domain/santa'

// A Secret Santa group, as this person gets it: a member gets the members and, of the draw,
// their own name alone; anyone else gets what they need to decide whether to join.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const group = getGroup(useDb(), user.id, token)
  if (!group) fail(404, 'not_found')
  return group
})
