import { deleteInput } from '../../../../../../shared/schemas/input'
import { deleteWish } from '../../../../../domain/wishes'

// Always the same answer for a wish on a list of yours: 204. It comes off this list only, so what
// buyers did with it and whoever else it is shared with play no part, and its image stays on disk.
// `clearForBuyers` makes it gone at once for whoever bought it too; the answer is the same.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const options = await readInput(event, deleteInput)
  domain(() => deleteWish(useDb(), user.id, token, id, options))
  return sendNoContent(event)
})
