import { deleteList } from '../../../domain/lists'

// Always the same answer for a list of yours: 204, whatever buyers did on it. A list someone else
// owns too can only be left, not deleted (409 list_shared).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  domain(() => deleteList(useDb(), user.id, token))
  return sendNoContent(event)
})
