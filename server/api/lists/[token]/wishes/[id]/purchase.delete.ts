import { removePurchase } from '../../../../../domain/purchases'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  domain(() => removePurchase(useDb(), token, id, user.id))
  return sendNoContent(event)
})
