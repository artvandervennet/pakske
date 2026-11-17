import { leaveList } from '../../../domain/lists'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  domain(() => leaveList(useDb(), user.id, token))
  return sendNoContent(event)
})
