import { leaveGroup } from '../../../domain/santa'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  domain(() => leaveGroup(useDb(), user.id, token))
  return sendNoContent(event)
})
