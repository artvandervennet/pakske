import { listFriends, listRequests } from '../../domain/friends'

// The person's own friends, what goes each way, and the requests they got and sent. Nothing in
// it is about anyone else's friends.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = useDb()
  return { friends: listFriends(db, user.id), requests: listRequests(db, user.id) }
})
