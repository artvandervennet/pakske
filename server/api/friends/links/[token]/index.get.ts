import { getFriendLink } from '../../../../domain/friends'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const link = getFriendLink(useDb(), token, user.id)
  if (!link) fail(404, 'not_found')
  return link
})
