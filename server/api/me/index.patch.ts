import { profileInput } from '../../../shared/schemas/input'
import { updateProfile } from '../../domain/users'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readInput(event, profileInput)
  updateProfile(useDb(), user.id, input)
  // The header shows the name from the session.
  await setUserSession(event, { user: { id: user.id, username: user.username, displayName: input.displayName } })
  return { displayName: input.displayName, listIntro: input.listIntro }
})
