import { withdrawRequest } from '../../../../domain/friends'

// The sender takes a request back.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = requestParam(event)
  domain(() => withdrawRequest(useDb(), user.id, id))
  return sendNoContent(event)
})
