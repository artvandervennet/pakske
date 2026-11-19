# Mails

Firebase sends Pakske's mails. Their text is in this folder, one file per template in the Firebase console under Authentication → Templates. To use one: open the template, press the pencil, fill in the fields below and save.

Firebase refuses that for some projects: "Email template updates are currently unavailable for this project". Only Firebase support can lift it. Until then the mails go out in Firebase's own words, and these files wait.

| Template | Sender name | Subject | Message |
| --- | --- | --- | --- |
| Password reset | `Pakske` | `Nieuw wachtwoord voor Pakske / New password for Pakske` | `password-reset.html` |
| Email address change | `Pakske` | `Het e-mailadres van je Pakske-account is gewijzigd / Your Pakske email address changed` | `email-change.html` |
| Email address verification | `Pakske` | `Bevestig je e-mailadres voor Pakske / Confirm your email address for Pakske` | `email-verification.html` |
| Multi-factor enrolment notification | `Pakske` | `Tweede stap toegevoegd aan je Pakske-account / Second step added to your Pakske account` | `multi-factor-enrolment.html` |

When each one goes out:

- **Password reset**: "Wachtwoord vergeten?" on the login page, and "Wachtwoord instellen" in Settings for an account made with Google. The mail is worded to fit both.
- **Email address change**: to the old address, after someone clicked the link that confirms their new one. Its button puts the old address back.
- **Email address verification** and **Multi-factor enrolment notification**: never, as the site is now. It doesn't confirm the address someone registers with and has no second step for logging in.

The link Firebase mails to a new address ("E-mailadres wijzigen" in Settings) has no template in the console, so that mail stays in Firebase's own words.

Each mail has Dutch on top and English under it. Firebase stops translating a template once you change it, so one text has to serve both languages. The page behind the button still follows the language of the site (`X-Firebase-Locale` in `server/utils/firebase.ts`, which comes back as `lang` in the link).

`%LINK%` opens Firebase's own page, or the site's `/auth/action` once the project's action URL is set (step 6 under [Logging in: Firebase](../deploying.md#logging-in-firebase)).

The placeholders are Firebase's: `%LINK%`, `%EMAIL%`, `%NEW_EMAIL%`, `%SECOND_FACTOR%` and `%DISPLAY_NAME%`. Firebase only knows a name the site has told it, which it does when an account is made, at every login, and when the name changes in Settings (`tellName` in `server/domain/accounts.ts`). An account that hasn't logged in since the site started doing that gets "Dag ," until it does.

`%APP_NAME%` is left out: it prints the project's public-facing name from Firebase's settings, which isn't necessarily "Pakske".

The colours are the theme's maroon and yellow as hex, because mail programs don't read `oklch()`. After `pnpm theme` with other pigments, change `#722329` (brand), `#eadd8e` (partner), `#190405` (ink) and `#654b4a` (muted ink) here too.

To see a mail before pasting it, open the file in a browser. The placeholders show as text.
