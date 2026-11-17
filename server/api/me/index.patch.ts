import { profileInput } from '../../../shared/schemas/input'
import { updateDisplayName } from '../../domain/users'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readInput(event, profileInput)
  updateDisplayName(useDb(), user.id, input.displayName)
  // The header shows the name from the session.
  await setUserSession(event, { user: sessionUserOf({ ...user, displayName: input.displayName }) })
  return { displayName: input.displayName }
})
