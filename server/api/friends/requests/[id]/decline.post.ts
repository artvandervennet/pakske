import { answerRequest } from '../../../../domain/friends'

// Declining tells nobody: to its sender the request goes on waiting.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = requestParam(event)
  domain(() => answerRequest(useDb(), user.id, id, false))
  return sendNoContent(event)
})
