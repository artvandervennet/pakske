import { deleteMessage } from '../../domain/messages'

// Someone else's message is "not found", the same as one that doesn't exist.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = requestParam(event)
  domain(() => deleteMessage(useDb(), user.id, id))
  return sendNoContent(event)
})
