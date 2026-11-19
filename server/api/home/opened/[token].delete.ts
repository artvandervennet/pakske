import { takeOffPage } from '../../../domain/visits'

// "Weghalen": takes someone else's list off the person's own page, also one a friend shows them.
export default defineEventHandler(async (event) => {
  const token = tokenParam(event)
  const userId = await sessionUserId(event)
  if (userId === null) writeOpened(event, readOpened(event).filter(opened => opened !== token))
  else takeOffPage(useDb(), userId, token)
  return sendNoContent(event)
})
