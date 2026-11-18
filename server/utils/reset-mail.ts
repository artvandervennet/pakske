import type { H3Event } from 'h3'

/** Asks Firebase to mail a link for a new password, in the page's language, back to its login page. */
export async function sendResetMail(event: H3Event, email: string, locale: 'nl' | 'en') {
  const origin = getRequestURL(event, { xForwardedHost: useRuntimeConfig().trustProxy === true }).origin
  await useIdentity().sendPasswordReset(email, { locale, continueUrl: `${origin}${locale === 'en' ? '/en' : ''}/login` })
}
