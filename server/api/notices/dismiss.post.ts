import { noticeIdsInput } from '../../../shared/schemas/input'
import { dismissNotices } from '../../domain/undo'

// "Alles wissen" behind the bell: the notices the page names, at once. Always 204: an id that
// isn't a notice of yours is skipped, and so is a notice about something a friend sent, which
// only its own cross or its answer takes away.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { ids } = await readInput(event, noticeIdsInput)
  const { unused } = domain(() => dismissNotices(useDb(), user.id, ids))
  await removeUploads(unused)
  return sendNoContent(event)
})
