import { profileInput } from '../../../shared/schemas/input'
import { updateProfile } from '../../domain/users'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readInput(event, profileInput)
  const updated = domain(() => updateProfile(useDb(), user.id, input))
  // The header shows the name from the session, and a tick starts from its "anoniem geven".
  await setUserSession(event, { user: sessionUserOf(updated) })
  return { displayName: updated.displayName, anonymousDefault: updated.anonymousDefault }
})
