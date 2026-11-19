import { mailLinkCode } from '../../../shared/schemas/input'

// What the link in a mail from Firebase is for, so its page can say so before anything happens.
// Asking uses nothing up. `link` is null for a link that is used, expired or made up.
export default defineEventHandler(async (event) => {
  const code = mailLinkCode.safeParse(getQuery(event).code)
  if (!code.success) return { link: null }
  return { link: await useIdentity().checkMailLink(code.data) }
})
