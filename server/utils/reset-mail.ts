import type { H3Event } from 'h3'

/** The login page in a language, as an address for the button in a mail from Firebase. */
export function loginPageUrl(event: H3Event, locale: 'nl' | 'en'): string {
  return `${siteOrigin(event)}${locale === 'en' ? '/en' : ''}/login`
}

/** Asks Firebase to mail a link for a new password, in the page's language, back to its login page. */
export async function sendResetMail(event: H3Event, email: string, locale: 'nl' | 'en') {
  await useIdentity().sendPasswordReset(email, { locale, continueUrl: loginPageUrl(event, locale) })
}
