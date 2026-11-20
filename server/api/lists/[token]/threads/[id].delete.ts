import { deleteThread } from '../../../../domain/messages'

// An owner deletes a conversation on their list. Anyone else, and a conversation that isn't
// there, gets "not found".
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = requestParam(event)
  domain(() => deleteThread(useDb(), user.id, token, id))
  return sendNoContent(event)
})
