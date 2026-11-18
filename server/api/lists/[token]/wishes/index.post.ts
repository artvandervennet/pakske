import { wishInput } from '../../../../../shared/schemas/input'
import { addWish } from '../../../../domain/wishes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const input = await readInput(event, wishInput)
  const db = useDb()
  const wish = domain(() => addWish(db, user.id, token, input))
  setResponseStatus(event, 201)
  // A wish that starts with a link gets that link's cover as its picture, when the shop has one.
  const first = wish.urls[0]
  return (first && await refreshCover(db, user.id, token, wish.id, first)) || wish
})
