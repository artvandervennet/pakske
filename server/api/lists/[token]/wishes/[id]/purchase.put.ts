import { purchaseInput } from '../../../../../../shared/schemas/input'
import { setPurchase } from '../../../../../domain/purchases'

// An owner may tick their own wish too. A refusal is only a code, so it names nobody and gives no number.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const input = await readInput(event, purchaseInput)
  // No await between here and the end of setPurchase: see server/domain/purchases.ts.
  domain(() => setPurchase(useDb(), token, id, user.id, input.quantity, input.anonymous))
  return sendNoContent(event)
})
