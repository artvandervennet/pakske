import { wishInput } from '../../../../../shared/schemas/input'
import { addWish } from '../../../../domain/wishes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const input = await readInput(event, wishInput)
  const wish = domain(() => addWish(useDb(), user.id, token, input))
  setResponseStatus(event, 201)
  return wish
})
