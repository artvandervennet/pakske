import { deleteGroup } from '../../../domain/santa'

// Ends a group, which only the person who runs it can do.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  domain(() => deleteGroup(useDb(), user.id, token))
  return sendNoContent(event)
})
