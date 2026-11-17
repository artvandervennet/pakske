import { purchaseInput } from '../../../../shared/schemas/input'
import { setPurchase } from '../../../domain/purchases'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = idParam(event)
  const input = await readInput(event, purchaseInput)
  // No await between here and the end of setPurchase: see server/domain/purchases.ts.
  domain(() => setPurchase(useDb(), id, user.id, input.quantity))
  return sendNoContent(event)
})
