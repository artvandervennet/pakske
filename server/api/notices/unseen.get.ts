import { countUnseen } from '../../domain/notices'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return { unseen: countUnseen(useDb(), user.id) }
})
