import { removeMember } from '../../../../domain/santa'

// Takes someone out of a group before the draw, which only the person who runs it can do.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const memberId = idParam(event)
  domain(() => removeMember(useDb(), user.id, token, memberId))
  return sendNoContent(event)
})
