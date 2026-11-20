# Pakske

[![CI](https://github.com/artvandervennet/pakske/actions/workflows/ci.yml/badge.svg)](https://github.com/artvandervennet/pakske/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-722329.svg)](LICENSE)

Pakske is a wishlist site for family and friends. Everyone with an account can make several lists. Each list has an address the site makes up, and only people who have the link can find it; anyone who has it can pass it on. Buyers tick what they are getting and leave each other notes. The owners of a wish see none of that: to them it looks as if nobody bought anything, unless they tick it themselves.

A wish can belong to several people and show on a list of each of them, and a list can have several owners. Buyers from every list that shows a wish see the same purchases; each owner sees only their own tick.

Built with Nuxt 4 and [Gesso](https://github.com/artvandervennet/gesso), in Dutch and English, for a Raspberry Pi.

## What it does

- **Lists behind a link.** No page lists other people's lists; the link is the only way in.
- **Giving without spoiling it.** Buyers see who gives what and can write notes to each other. A wish's owners never see purchases or notes. [Who sees what](docs/who-sees-what.md) has the rules, how the server keeps them, and the one limit.
- **Giving anonymously.** A buyer can give without their name, per wish or as their account's default.
- **One, several or without a limit.** A wish asks for a number, and each buyer takes their share of it.
- **Links and a picture.** A wish has up to five links. Without a photo of your own, the server fetches the cover of the first link.
- **Sharing wishes.** A share link gives someone a copy of your wishes, or makes you both owners of the same wish. A list can have several owners too.
- **Secret Santa, on the side.** A group joins by a link, each member with a list of their own, and the names are drawn once. Each member sees the one name they drew; nobody else does, the organiser included.
- **Accounts through Firebase.** Firebase Authentication holds the passwords and the Google logins and sends the mails; everything else is in one SQLite file.

## Run it locally

You need Node 26, the version the Docker image and CI use, and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm dev
```

The site is at <http://localhost:3400> (set in `nuxt.config.ts` under `devServer`). The database and uploaded images go in `.data/`. In development Nuxt makes its own secret. Logging in needs Firebase: put `NUXT_FIREBASE_API_KEY` in a `.env` (a second Firebase project for trying things out is a good idea), or run the Firebase emulator (`npx firebase-tools emulators:start --only auth`, which needs Java) and set `NUXT_FIREBASE_AUTH_EMULATOR_HOST=localhost:9099` with any API key.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm test` | Unit tests for the rules (Vitest, in-memory SQLite) |
| `test/api-check.sh` | Checks the HTTP API and the rendered pages as four people and as visitors; see the top of the file |
| `pnpm typecheck` | Type check |
| `pnpm theme` | Rebuilds `app/assets/css/theme.css` from `theme.json` |
| `pnpm db:generate` | Writes a migration after a change to `server/db/schema.ts` |
| `pnpm build` | Production build in `.output/`; run it with `node .output/server/index.mjs` from the project folder |

## Deploy

Pakske runs in Docker, on a Raspberry Pi with a 64-bit OS or on any other Docker host:

```sh
git clone https://github.com/artvandervennet/pakske.git && cd pakske
cp .env.example .env
openssl rand -base64 32        # paste the output into .env as NUXT_APP_SECRET
docker compose up -d --build
```

It listens on port 3000 and keeps its data in the Docker volume `pakske-data`. It also needs a Firebase project for logging in. [Deploying on a Raspberry Pi](docs/deploying.md) has the settings, the Firebase and Google steps, putting HTTPS in front of it, updating, and backing up and restoring.

## Documentation

- [Who sees what](docs/who-sees-what.md): what a visitor, an owner and a buyer each get, and the rules that keep an owner from finding out what was bought.
- [Deploying on a Raspberry Pi](docs/deploying.md): settings, Firebase, Google login, updates, backups.
- [How it is put together](docs/how-it-works.md): the folders, how each part works, what Gesso needs, and what is left out on purpose.
- [The mails Firebase sends](docs/mails/README.md): the templates and where they go in the Firebase console.

The site itself has a privacy page (`/privacy`) and terms (`/terms`). Whoever runs it [fills in their name and address](docs/deploying.md#the-privacy-page-and-the-terms).

## Contributing

Bug reports and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) says how to set up, what to run before you open a pull request, and which rules a change must keep. Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Security

Please report a security problem in private, not in a public issue. [SECURITY.md](SECURITY.md) says how.

## License

[MIT](LICENSE) © Art Van der Vennet
