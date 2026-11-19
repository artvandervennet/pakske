import { answerRequest } from '../../../../domain/friends'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = requestParam(event)
  return domain(() => answerRequest(useDb(), user.id, id, true))
})
