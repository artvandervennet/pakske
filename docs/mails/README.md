# Mails

Firebase sends Pakske's mails. Their text is in this folder. Paste it into the Firebase console under Authentication → Templates: open a template, press the pencil, fill in the fields below and save.

| Template | Sender name | Subject | Message |
| --- | --- | --- | --- |
| Password reset | `Pakske` | `Nieuw wachtwoord voor Pakske / New password for Pakske` | `password-reset.html` |
| Email address change | `Pakske` | `Het e-mailadres van je Pakske-account is gewijzigd / Your Pakske email address changed` | Firebase's own |
| Email address verification | `Pakske` | `Bevestig je e-mailadres voor Pakske / Confirm your email address for Pakske` | Firebase's own |

Pakske only sends the first one, in two cases: "Wachtwoord vergeten?" on the login page, and "Wachtwoord instellen" in Settings for an account made with Google. The mail is worded to fit both. The site never changes or confirms an address, so the other two only get a sender and a subject, in case that changes.

The mail has Dutch on top and English under it. Firebase stops translating a template once you change it, so one text has to serve both languages. The page behind the button still follows the language of the site (`X-Firebase-Locale` in `server/utils/firebase.ts`).

The mail uses two of Firebase's placeholders, `%LINK%` and `%EMAIL%`, and leaves out two others:

- `%DISPLAY_NAME%`, because an account made with email and password has no name at Firebase; the site keeps names in its own database. The mail would start with "Dag ,".
- `%APP_NAME%`, because it prints the project's public-facing name from Firebase's settings, which isn't necessarily "Pakske".

The colours are the theme's maroon and yellow as hex, because mail programs don't read `oklch()`. After `pnpm theme` with other pigments, change `#722329` (brand), `#eadd8e` (partner), `#190405` (ink) and `#654b4a` (muted ink) here too.

To see the mail before pasting it, open the file in a browser. The placeholders show as text.
