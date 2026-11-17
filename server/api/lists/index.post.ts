import { listInput } from '../../../shared/schemas/input'
import { createList } from '../../domain/lists'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readInput(event, listInput)
  const list = domain(() => createList(useDb(), user.id, input.title))
  setResponseStatus(event, 201)
  return list
})
