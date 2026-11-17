import { getListView } from '../../../domain/list-view'
import { rememberList } from '../../../domain/visits'

// The one endpoint that returns a list. `getListView` decides per wish what this viewer may see,
// so the response, and with it the page's server-rendered payload, never holds more than that.
export default defineEventHandler(async (event) => {
  const token = tokenParam(event)
  const viewerId = await sessionUserId(event)
  const db = useDb()
  const view = getListView(db, token, viewerId)
  if (!view) fail(404, 'not_found')

  // Opening someone's list puts it on your home page: in the account, or in a cookie when logged out.
  if (viewerId === null) writeOpened(event, withOpened(readOpened(event), token))
  else if (!view.viewerOwnsList) rememberList(db, viewerId, token)
  return view
})
