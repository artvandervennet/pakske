import { markNoticesSeen } from '../../domain/notices'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  markNoticesSeen(useDb(), user.id)
  return sendNoContent(event)
})
