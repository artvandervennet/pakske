import { deleteInput } from '../../../../shared/schemas/input'
import { deleteList } from '../../../domain/lists'

// Always the same answer for a list of yours: 204, whatever buyers did on it. A list someone else
// owns too can only be left, not deleted (409 list_shared). `clearForBuyers` leaves nothing of it
// for whoever bought something on it; the answer is the same.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const options = await readInput(event, deleteInput)
  domain(() => deleteList(useDb(), user.id, token, options))
  return sendNoContent(event)
})
