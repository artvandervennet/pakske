import { markRequestsSeen } from '../../../domain/friends'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  markRequestsSeen(useDb(), user.id)
  return sendNoContent(event)
})
