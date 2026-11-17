import { registerInput } from '../../../shared/schemas/input'
import { createUser } from '../../domain/users'
import { mergeVisits } from '../../domain/visits'

const HOUR = 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  const key = `register:${clientIp(event)}`
  // Per address, counting accounts that were made. A family signing up from one house shares
  // an address, so the limit leaves room for that.
  if (isLimited(key, 20)) fail(429, 'rate_limited')

  const input = await readInput(event, registerInput)

  const passwordHash = await hashPassword(input.password)
  const db = useDb()
  const user = domain(() => createUser(db, {
    email: input.email,
    displayName: input.displayName,
    passwordHash,
  }, { maxUsers: Number(useRuntimeConfig().maxUsers) }))

  countHit(key, HOUR)
  await setUserSession(event, { user: { id: user.id, displayName: user.displayName } })
  // The lists opened before making the account move into it, so the cookie isn't needed any more.
  mergeVisits(db, user.id, readOpened(event))
  clearOpened(event)
  setResponseStatus(event, 201)
  return { displayName: user.displayName }
})
