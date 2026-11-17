import { targetInput } from '../../../../../../shared/schemas/input'
import { linkWish } from '../../../../../domain/sharing'

// The same answer whatever buyers did with the wish: linking never looks at purchases.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const input = await readInput(event, targetInput)
  const landed = domain(() => linkWish(useDb(), user.id, token, id, input))
  setResponseStatus(event, 201)
  return landed
})
