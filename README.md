# Wishlist

A wishlist site for family and friends. Everyone with an account has one list at a public address. Buyers see who buys how many of each wish and leave each other notes. The owner of a list sees none of that: their own list looks as if nobody bought anything.

Built with Nuxt 4 and [Gesso](https://github.com/artvandervennet/gesso), in Dutch and English, for a Raspberry Pi.

## Run it locally

```sh
pnpm install
pnpm dev
```

The site is at <http://localhost:3400> (set in `nuxt.config.ts` under `devServer`). The database and uploaded images go in `.data/`. In development Nuxt makes its own secret, so no `.env` is needed.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm test` | Unit tests for the rules (Vitest, in-memory SQLite) |
| `test/api-check.sh` | Checks the HTTP API as three people and a visitor; see the top of the file |
| `pnpm typecheck` | Type check |
| `pnpm theme` | Rebuilds `app/assets/css/theme.css` from `theme.json` |
| `pnpm db:generate` | Writes a migration after a change to `server/db/schema.ts` |
| `pnpm build` | Production build in `.output/`; run it with `node .output/server/index.mjs` from the project folder |

## Who sees what

| | Wishes | Who bought what | Notes |
| --- | --- | --- | --- |
| Visitor, not logged in | yes | no | no |
| Owner, on their own list | yes | no | no |
| Anyone else who is logged in | yes | yes | yes |

The server decides this, not the page. `getList` in `server/domain/list.ts` picks the view from the session, and the two views are built by different code:

- `server/domain/public-list.ts` serves the owner and visitors. It only reads accounts and wishes.
- `server/domain/buyer-list.ts` serves buyers, and adds purchases, notes and removed wishes.

The page shows whatever the API returned, so the HTML that Nuxt renders on the server can't contain more than the person may see.

Rules that keep the owner from finding out by a detour:

- Deleting a wish always answers 204 and keeps the row and its image. Buyers who bought it still see it, marked as removed.
- Lowering an amount below what is bought is always accepted. Buyers then see "3 gekocht, 2 gevraagd".
- Buying and writing notes never change a wish's `updatedAt` or its place in the list.
- On their own list the owner gets a fixed 403 from the purchase and note endpoints, and "not found" for any note.
- Pages and API answers are sent with `Cache-Control: private, no-store`. Logging in and out reloads the page.
- Note ids are random, so a gap in a sequence can't hint at notes written elsewhere.

`test/visibility.test.ts` builds two databases that differ only in what buyers did and checks that the owner and a visitor get identical results from both.

One limit: someone can register a second account and look at their own list as a buyer. Nothing in the code can stop that.

## Deploy on a Raspberry Pi

The Pi needs a 64-bit OS (`uname -m` says `aarch64`) and Docker.

```sh
git clone <this repo> wishlist && cd wishlist
cp .env.example .env
openssl rand -base64 32        # paste the output into .env as NUXT_APP_SECRET
docker compose up -d --build
```

The site listens on port 3000. Data lives in the Docker volume `wishlist-data`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NUXT_APP_SECRET` | none, required | Seals the login cookies. At least 32 characters. The server refuses to start without it. Changing it logs everyone out. |
| `NUXT_SESSION_COOKIE_SECURE` | `true` | The login cookie is only sent over HTTPS. Set `false` only when you open the site as plain `http://` on your home network; otherwise logging in silently fails there. |
| `NUXT_TRUST_PROXY` | `false` | Set `true` behind a tunnel or reverse proxy, so the rate limits see each visitor's own address. Leave `false` when the port is reached directly. |
| `NUXT_MAX_USERS` | `200` | Registration closes at this many accounts. |
| `PORT` | `3000` | The port on the host. |

To reach the site from outside your home, put HTTPS in front of it: a Cloudflare Tunnel, Tailscale Funnel, or Caddy with a port forward. In that case:

- keep `NUXT_SESSION_COOKIE_SECURE=true`;
- set `NUXT_TRUST_PROXY=true`. Otherwise every visitor seems to come from the proxy's address, and the limits on wrong passwords and on new accounts count for everyone together.

The server expects exactly one proxy in front and takes the visitor's address from the last entry of `X-Forwarded-For`.

### Update

```sh
git pull
docker compose up -d --build
```

New migrations run when the server starts.

### Back up

Everything is in the volume: `wishlist.db` and the `uploads/` folder. This copies both into `backup/` while the site keeps running:

```sh
mkdir -p backup
docker compose exec wishlist rm -f /data/backup.db
docker compose exec wishlist node -e "new (require('node:sqlite').DatabaseSync)('/data/wishlist.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp wishlist:/data/backup.db backup/wishlist.db
docker compose cp wishlist:/data/uploads backup/
```

### Restore

Stop the site, put the files back as the user the server runs as, and start it again:

```sh
docker compose down
docker compose run --rm -u root -v "$PWD/backup:/backup:ro" wishlist sh -c \
  'rm -f /data/wishlist.db-wal /data/wishlist.db-shm && cp /backup/wishlist.db /data/wishlist.db && mkdir -p /data/uploads && cp -r /backup/uploads/. /data/uploads/ && chown -R node:node /data'
docker compose up -d
```

The two `rm`'d files are SQLite's journal. Left in place after a power cut, they would be replayed over the restored database.

### Someone forgot their password

The site sends no email. Give the account a new password by hand:

```sh
docker compose exec wishlist node scripts/reset-password.mjs mom@example.com
```

It prints a random password. The person logs in with it and picks their own under Settings.

## How it is put together

```text
app/            pages, components and composables (the Vue side)
  assets/css/   main.css imports Gesso; theme.css is generated; app.css holds the app's own styles
  plugins/      gesso.client.ts registers Gesso's custom elements in the browser
i18n/locales/   nl.json and en.json
server/
  api/          the HTTP API
  db/           schema and migrations (Drizzle, SQLite)
  domain/       the rules, as plain functions that take a database; no Nuxt in here
  middleware/   01.security.ts: cache headers, origin check, body size limits
  utils/        database handle, HTTP helpers, rate limiter, uploads
shared/schemas/ zod schemas for what comes in and what goes out
test/           unit tests and the API check
```

- **Accounts**: `nuxt-auth-utils`, a sealed cookie session and scrypt password hashes.
- **Amounts**: a wish has a whole number or no limit (`quantity` is `NULL`). Each buyer has one purchase per wish with their own number. `setPurchase` in `server/domain/purchases.ts` checks the total in one synchronous transaction, so two buyers can't both take the last one.
- **Images**: the browser scales a picture to at most 1600 pixels and re-encodes it as JPEG before uploading (`app/composables/useImageResize.ts`). The server checks the size (3 MB) and the first bytes of the file, and stores it under a random name.
- **Languages**: Dutch at `/…`, English at `/en/…`. The server answers with error codes; the words are in the locale files under `errors` and `fields`.
- **Guard rails**: five wrong passwords lock an account for fifteen minutes, registration is limited per address, and requests that change something are refused when they come from another site. A tab that comes back into view checks who is logged in and reloads if that changed (`app/plugins/session-watch.client.ts`).

## Gesso

Gesso is installed from git, pinned to a tag in `package.json`. The theme "Ribbon" is this project's own: three pigments in `theme.json`, built by `pnpm theme`.

Things to know when changing the UI:

- The components need the DOM, so they are only imported in `app/plugins/gesso.client.ts`. The server sends plain HTML and the elements upgrade it. `app.css` styles buttons and cards before they upgrade, so the page doesn't jump.
- Every page starts with a band in the deep paint (`PageHead.vue`, or the hero on the home page). `<art-header>` takes its paint from the first band.
- `<art-header>` and `<art-canvas>` read their children and attributes once. To change them, change the element's `key`.
- Pass boolean attributes as `value || undefined`. Vue renders `false` as `wet="false"`, which Gesso reads as present.
- `<art-signature>` writes its text into `innerHTML`. It only gets fixed text.
- The words inside `<art-scheme>` (System, Light, Dark) and the header's "Menu" come from Gesso and are English in both languages.

`app.css` marks three blocks as candidates to move into Gesso: the invalid-field state, the success message of a form, and the amount bar.

## Not included

- Email: no verification and no reset mail.
- Fetching a title or picture from a pasted shop link.
- Prices, reordering wishes, restoring a deleted wish.
- More than one list per account.
