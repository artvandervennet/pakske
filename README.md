# Wishlist

A wishlist site for family and friends. Everyone with an account can make several lists. Each list has an address the site makes up, and only people who have the link can find it; anyone who has it can pass it on. Buyers tick what they are getting and leave each other notes. The owners of a wish see none of that: to them it looks as if nobody bought anything, unless they tick it themselves.

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

The server decides this per wish, not per list. Each wish has its own owners in `wish_owners`; for now they are always the owners of the list it was added to.

| | The wish | Who bought how many | Notes |
| --- | --- | --- | --- |
| Visitor, not logged in | yes | no | no |
| An owner of the wish | yes | only their own tick | no |
| Anyone else who is logged in | yes | yes, with names | yes |

`getListView` in `server/domain/list-view.ts` builds a list for one viewer. It splits the wishes into the ones the viewer owns and the rest, and builds each kind with different code:

- A visitor gets the wishes from `server/domain/public-wishes.ts`. That file only reads wishes and the list they are on.
- An owner gets the same wishes and their own purchase. The purchases table is read for the viewer's own rows only.
- Anyone else gets every purchase with name and number, the notes, and the wishes that were removed after someone bought them.

The page shows whatever the API returned, so the HTML that Nuxt renders on the server can't contain more than the person may see.

Every request about a wish goes through a list link: the URL names the list's token, and the wish must be on that list (`wishOnList` in `server/domain/purchases.ts`). A wish's number alone gives no access. The one request that names no list is deleting your own note: it goes by the note's random id, and only its author gets anything but "not found".

An owner can tick their own wish. Before every tick or higher number the site asks "You might find out that someone already got this. Continue?"; unticking and lowering don't ask. When not enough are left, the owner reads "Someone already has this" or "There aren't that many left" and nothing is recorded. The server answers with a code only, so the refusal names nobody and gives no number. The owner's row never says how many are left, and its + is always enabled.

Rules that keep an owner from finding out by a detour:

- Deleting a wish always answers 204 and keeps the row and its image. Buyers who bought it still see it, marked as removed.
- Lowering an amount below what is bought is always accepted. Buyers then see that none are left.
- Deleting a list deletes every wish on it the same way. After that its owners and logged-out visitors get "not found", whatever was bought; buyers still see what they bought on it.
- Buying and writing notes never change a wish's `updatedAt` or its place in the list.
- An owner of a wish gets a fixed 403 when they try to write a note on it. Deleting a note that isn't yours answers "not found", the same as a note that doesn't exist.
- Pages and API answers are sent with `Cache-Control: private, no-store`. Logging in and out reloads the page.
- Note ids are random, so a gap in a sequence can't hint at notes written elsewhere.

`test/visibility.test.ts` builds two databases that differ only in what buyers did and checks that the owner and a visitor get identical results from both. The owner's own purchase is the one difference, and only the owner sees it.

One limit: an owner can register a second account and open their own list as a buyer. Nothing in the code can stop that.

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

A database made by the first version, from before private lists, can't be upgraded: the server stops at start with a "table already exists" error. Remove the old `wishlist.db` and its `wishlist.db-wal` and `wishlist.db-shm` files from the data folder (in Docker, the volume `wishlist-data`) and start again. Accounts and wishes from the first version are not carried over.

```sh
docker compose down
docker compose run --rm -u root wishlist sh -c 'rm -f /data/wishlist.db /data/wishlist.db-wal /data/wishlist.db-shm'
docker compose up -d --build
```

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
  pages/        index.vue is the home page, l/[token].vue a list
  plugins/      gesso.client.ts registers Gesso's custom elements in the browser
i18n/locales/   nl.json and en.json
server/
  api/          the HTTP API; requests about a wish are under lists/[token]/wishes/
  db/           schema and migrations (Drizzle, SQLite)
  domain/       the rules, as plain functions that take a database; no Nuxt in here
  middleware/   01.security.ts: cache headers, origin check, body size limits
  routes/       uploads/: serves the pictures
  utils/        database handle, HTTP helpers, rate limiter, uploads, the cookie of opened lists
shared/
  schemas/      zod schemas for what comes in and what goes out
  utils/        the words on a row, the order of the rows, what a tick may do and what an edit sends, shared by the page and the tests
test/           unit tests and the API check
```

- **Accounts**: `nuxt-auth-utils`, a sealed cookie session and scrypt password hashes. Registering asks for a name, an email address and a password. The cookie holds the account's id and the moment the account was made; a cookie whose account is gone, or whose id now belongs to another account (after a restore, say), logs nobody in, for the API and the page alike (`sessionBelongsTo` in `server/domain/users.ts`).
- **Lists**: a list has a title, one or more owners (`list_owners`) and a token of 16 random bytes in base64url, made by `newListToken` in `server/domain/tokens.ts`. The token is the list's address, `/l/<token>`, and the only way in: no page lists other people's lists. Owners rename a list (the address stays) and delete it. A wish is shown on a list through `list_wishes`.
- **Remembered lists**: opening someone else's list puts it on your home page under "Lists you opened". Logged in, that is a row in `list_visits`. Logged out, its token goes into the `opened-lists` cookie (at most 50). A cookie and not local storage, because the server builds the home page. Logging in or registering moves the cookie's lists into the account and clears the cookie. "Remove" only takes a list off the home page; the link keeps working.
- **Amounts**: a wish has a whole number or no limit (`quantity` is `NULL`). Adding one takes only a title; the amount starts at one. Each person has one purchase per wish with their own number. `setPurchase` in `server/domain/purchases.ts` checks the total in one synchronous transaction, so two buyers can't both take the last one.
- **Images**: the browser scales a picture to at most 1600 pixels and re-encodes it as JPEG before uploading (`app/composables/useImageResize.ts`). The server checks the size (3 MB) and the first bytes of the file, and stores it under a random name.
- **Languages**: Dutch at `/…`, English at `/en/…`. The server answers with error codes; the words are in the locale files under `errors` and `fields`.
- **Guard rails**: five wrong passwords lock an account for fifteen minutes, registration is limited per address, and requests that change something are refused when they come from another site. A tab that comes back into view checks who is logged in and reloads if that changed (`app/plugins/session-watch.client.ts`).

## Gesso

Gesso is installed from git, pinned to a tag in `package.json`. The theme "Ribbon" is this project's own: three pigments in `theme.json`, built by `pnpm theme`.

Things to know when changing the UI:

- The components need the DOM, so they are only imported in `app/plugins/gesso.client.ts`. The server sends plain HTML and the elements upgrade it. `app.css` styles buttons before they upgrade, so the page doesn't jump.
- Every page starts with a band in the deep paint (`PageHead.vue`, or the hero on the home page). `<art-header>` takes its paint from the first band.
- `<art-header>` reads its children and attributes once. To change it, change the element's `key`.
- Pass boolean attributes as `value || undefined`. Vue renders `false` as `wet="false"`, which Gesso reads as present.
- `<art-signature>` writes its text into `innerHTML`. It only gets fixed text.
- The words inside `<art-scheme>` (System, Light, Dark) and the header's "Menu" come from Gesso and are English in both languages.

`app.css` marks the blocks that fill gaps in Gesso as candidates to move there: among them the rows of a list, the rows that unfold, the tick box and stepper, the + row that turns into the new row, the small picture with its painted study, text edited where it is read (`.inline-edit`, used for an owner's wish and a list's title), the amount with its stepper and switch, and the picture that is its own control.

## Not included

- Joint wishes and joint lists, "Add to my list" and notices: step two in `docs/superpowers/specs/2026-11-17-private-lists-and-joint-wishes-design.md`, designed but not built.
- Email: no verification and no reset mail.
- Fetching a title or picture from a pasted shop link.
- Prices, reordering wishes, restoring a deleted wish.
- Seeing who opened your list, or taking a list away from someone who has the link.
