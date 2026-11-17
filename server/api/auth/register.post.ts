import { registerInput } from '../../../shared/schemas/input'
import { createUser } from '../../domain/users'

const HOUR = 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  const key = `register:${clientIp(event)}`
  // Per address, counting accounts that were made. A family signing up from one house shares
  // an address, so the limit leaves room for that.
  if (isLimited(key, 20)) fail(429, 'rate_limited')

  const input = await readInput(event, registerInput)

  const passwordHash = await hashPassword(input.password)
  const user = domain(() => createUser(useDb(), {
    email: input.email,
    username: input.username,
    displayName: input.displayName,
    passwordHash,
  }, { maxUsers: Number(useRuntimeConfig().maxUsers) }))

  countHit(key, HOUR)
  await setUserSession(event, { user: { id: user.id, username: user.username, displayName: user.displayName } })
  setResponseStatus(event, 201)
  return { username: user.username }
})
