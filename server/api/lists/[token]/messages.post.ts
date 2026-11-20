import { messageInput } from '../../../../shared/schemas/input'
import { sendMessage } from '../../../domain/messages'

const QUARTER = 15 * 60 * 1000

// A message on a list: to its owners from someone who opened it, or an owner's answer in the
// conversation it names. The owners are never sent who wrote.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const key = `message:${user.id}`
  if (isLimited(key, 30)) fail(429, 'rate_limited')
  const input = await readInput(event, messageInput)
  countHit(key, QUARTER)
  const sent = domain(() => sendMessage(useDb(), user.id, token, input.body, input.thread))
  setResponseStatus(event, 201)
  return sent
})
