import { acceptFriendLink } from '../../../../domain/friends'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  // No await between here and the end of acceptFriendLink, so of two people at once only one gets it.
  return domain(() => acceptFriendLink(useDb(), user.id, token))
})
