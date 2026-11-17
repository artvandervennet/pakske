import { getInviteView } from '../../../domain/invites'

// A link needs a login: someone who isn't logged in learns nothing, not even whether it exists.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const invite = tokenParam(event, 'invite')
  const view = getInviteView(useDb(), invite, user.id)
  if (!view) fail(404, 'not_found')
  return view
})
