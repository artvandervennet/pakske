import { unlinkOwner } from '../../../../../../../domain/sharing'

// The person is named by id, not by name, so two owners with one name stay apart.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)
  const owner = idParam(event, 'userId')
  domain(() => unlinkOwner(useDb(), user.id, token, id, owner))
  return sendNoContent(event)
})
