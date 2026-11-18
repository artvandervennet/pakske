# Contributing to Pakske

Pakske is a small site that one person runs for family and friends. Bug reports, ideas and pull requests are welcome. For anything bigger than a fix, open an issue first, so we can agree on the shape before you put work into it.

By taking part you agree to the [code of conduct](CODE_OF_CONDUCT.md). A security problem goes through [SECURITY.md](SECURITY.md), not through a public issue.

## Set up

You need Node 26 and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm dev
```

The site is at <http://localhost:3400>, with its database in `.data/`. Logging in needs Firebase. Either put the Web API key of a Firebase project of your own in `.env` as `NUXT_FIREBASE_API_KEY`, or run the Firebase emulator (`npx firebase-tools emulators:start --only auth`, which needs Java) and set `NUXT_FIREBASE_AUTH_EMULATOR_HOST=localhost:9099` with any API key. Everything that isn't behind a login works without either.

## Before you open a pull request

```sh
pnpm test        # the rules, against an in-memory database
pnpm typecheck
```

CI runs both on every pull request, and builds the site and its Docker image.

If you changed a route or what a page shows to whom, also run `test/api-check.sh` against a fresh server; the top of that file says how. It plays four people and a visitor over HTTP.

Look at what you changed in a browser, at phone width and at desktop width, logged in and logged out. Press the buttons with a real pointer: a control that sits under another one passes every scripted click.

## The rules a change must keep

[Who sees what](docs/who-sees-what.md) is the point of the site: the owners of a wish never learn what was bought, by whom, or what buyers wrote. A change that lets an owner find out, even by a detour such as a count, an error message, an order or a timestamp, is a bug, however useful the feature.

Two things keep it that way, and both are tested:

- Only `purchases.ts`, `notes.ts` and `list-view.ts` in `server/domain/` read purchases or notes. Tests read the other files' sources to check. A new domain file joins those checks.
- `test/visibility.test.ts` builds two databases that differ only in what buyers did, and checks that an owner and a visitor get the same answer from both.

## How the code is laid out

[How it is put together](docs/how-it-works.md) describes the folders and each part. The conventions, in short:

- **Routes are thin.** A route under `server/api/` reads who is asking and what they sent (`requireUser`, `tokenParam`, `readInput` with a zod schema from `shared/schemas/input.ts`) and calls one function in `server/domain/` through `domain()`.
- **Rules are plain functions.** A domain function takes the database, is synchronous, and does its work in one immediate transaction. No Nuxt in there. Work that waits on the network, such as Firebase or fetching a link's cover, happens outside the transaction.
- **Errors are codes.** A refusal is a `DomainError` with a code from `server/domain/errors.ts`. The code has a status in `server/utils/http.ts` and a sentence under `errors` in both `i18n/locales/nl.json` and `en.json`.
- **Two languages, same keys.** Every sentence exists in Dutch and in English. Quotes in them are round and at the top: “ ” and ’. `test/locales.test.ts` checks both.
- **Migrations.** Change `server/db/schema.ts`, run `pnpm db:generate`, and add any hand-written SQL after a `--> statement-breakpoint` with a `--` comment that says why. Never edit a migration that is already in `main`. A migration that moves data gets an upgrade test in `test/migrations.test.ts`.
- **Styles** are written against Gesso's role tokens (`--surface`, `--ink`, `--accent`, `--space-*`), never raw colours, so they follow the theme and dark mode.
- **Code style.** No semicolons, single quotes, two spaces. A comment says why something is the way it is, in a full sentence; it doesn't repeat the code.

## Tests

Write the test first when you change a rule: watch it fail, then make it pass. Tests are in `test/*.test.ts` and use the helpers in `test/helpers.ts` (`makeDb`, `addUser`, `addList`, `addWishTo`). Firebase is replaced by `test/fake-identity.ts`, so nothing in the suite touches the network.

A bug fix comes with the test that would have caught it.

## Commits and pull requests

A commit subject is one sentence in the imperative that says what changes for the person using the site, not which file changed:

```text
Let the buttons in an opened wish's head take their own clicks
Hold a DELETE that sends a body to the same size limit as the rest
```

Keep a pull request to one change. Say what it does, why, and how you checked it. A change to what people see gets a screenshot.

## License

Pakske is [MIT licensed](LICENSE). What you contribute is under the same license.
