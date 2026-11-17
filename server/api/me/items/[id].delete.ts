import { deleteItem } from '../../../domain/items'

// Always the same answer for a wish of yours that is on the list: 204. What buyers did with it
// plays no part, and its image stays on disk either way.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = idParam(event)
  domain(() => deleteItem(useDb(), user.id, id))
  return sendNoContent(event)
})
