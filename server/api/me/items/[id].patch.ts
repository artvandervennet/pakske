import { itemInput } from '../../../../shared/schemas/input'
import { updateItem } from '../../../domain/items'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = idParam(event)
  const input = await readInput(event, itemInput)
  return domain(() => updateItem(useDb(), user.id, id, input))
})
