import { forgetList } from '../../../domain/visits'

export default defineEventHandler(async (event) => {
  const token = tokenParam(event)
  const userId = await sessionUserId(event)
  if (userId === null) writeOpened(event, readOpened(event).filter(opened => opened !== token))
  else forgetList(useDb(), userId, token)
  return sendNoContent(event)
})
