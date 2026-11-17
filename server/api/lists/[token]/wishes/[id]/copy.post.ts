import { targetInput } from '../../../../../../shared/schemas/input'
import { copyWish } from '../../../../../domain/sharing'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const input = await readInput(event, targetInput)
  const landed = domain(() => copyWish(useDb(), user.id, token, id, input))
  setResponseStatus(event, 201)
  return landed
})
