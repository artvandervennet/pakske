import { removeOwner } from '../../../../domain/lists'

// Takes a co-owner off a list of the person's own. Only someone who joined the list after them
// can be removed; a list that isn't theirs and a person who doesn't own it are "not found".
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const ownerId = idParam(event)
  domain(() => removeOwner(useDb(), user.id, token, ownerId))
  return sendNoContent(event)
})
