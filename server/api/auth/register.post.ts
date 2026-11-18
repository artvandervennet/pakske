import { registerInput } from '../../../shared/schemas/input'
import { register } from '../../domain/accounts'

const HOUR = 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  const key = `register:${clientIp(event)}`
  // Per address, counting accounts that were made. A family signing up from one house shares
  // an address, so the limit leaves room for that.
  if (isLimited(key, 20)) fail(429, 'rate_limited')

  const input = await readInput(event, registerInput)
  const { user, login } = await domainAsync(() => register(useDb(), useIdentity(), input, { maxUsers: Number(useRuntimeConfig().maxUsers) }))

  countHit(key, HOUR)
  await startSession(event, user, login)
  setResponseStatus(event, 201)
  return { displayName: user.displayName }
})
