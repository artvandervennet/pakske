import { listFriendsForList } from '../../../domain/friends'

// The person's own friends, each with whether they find this list of the person's. For a list
// that isn't theirs: "not found".
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  return { friends: domain(() => listFriendsForList(useDb(), user.id, token)) }
})
