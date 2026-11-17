import { itemInput } from '../../../../shared/schemas/input'
import { createItem } from '../../../domain/items'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readInput(event, itemInput)
  const item = domain(() => createItem(useDb(), user.id, input))
  setResponseStatus(event, 201)
  return item
})
