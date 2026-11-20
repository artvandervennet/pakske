import { listGroups } from '../../domain/santa'

// The Secret Santa groups the person is in. Nobody finds a group they aren't in: its link is the way in.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return listGroups(useDb(), user.id)
})
