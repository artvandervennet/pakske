import { drawNames } from '../../../domain/santa'

// Draws the names, once. The answer says nothing about what came out: each member reads their
// own name from the group, and nobody reads anyone else's.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  // No await between here and the end of drawNames, so a second press can't draw again.
  domain(() => drawNames(useDb(), user.id, token))
  return sendNoContent(event)
})
