# Pakske

Pakske is a wishlist site for family and friends. Everyone with an account can make several lists. Each list has an address the site makes up, and only people who have the link can find it; anyone who has it can pass it on. Buyers tick what they are getting and leave each other notes. The owners of a wish see none of that: to them it looks as if nobody bought anything, unless they tick it themselves.

A wish can belong to several people and show on a list of each of them, and a list can have several owners. Buyers from every list that shows a wish see the same purchases; each owner sees only their own tick.

Built with Nuxt 4 and [Gesso](https://github.com/artvandervennet/gesso), in Dutch and English, for a Raspberry Pi.

## Run it locally

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

## Who sees what

The server decides this per wish, not per list. A wish's owners are in `wish_owners`: the owners of every list that shows it now. Someone else's list can hold a wish they share with you, so that page shows you that row as an owner and the others as a buyer.

| | The wish | Who bought how many | Notes |
| --- | --- | --- | --- |
| Visitor, not logged in | yes | no | no |
| An owner of the wish | yes | only their own tick | no |
| Anyone else who is logged in | yes | yes, with names | yes |

`getListView` in `server/domain/list-view.ts` builds a list for one viewer. It splits the wishes into the ones the viewer owns and the rest, and builds each kind with different code:

- A visitor gets the wishes from `server/domain/public-wishes.ts`. That file only reads wishes and the list they are on.
- An owner gets the same wishes and their own purchase. The purchases table is read for the viewer's own rows only.
- Anyone who owns neither the wish nor the list gets every purchase with name and number ("someone else" instead of the name when that buyer chose to give anonymously; the name never leaves the server), the notes, and the wishes that left the list after someone bought them.

Every viewer sees who else a wish belongs to: a row on Art's list that he shares with Lotte says "with Lotte". An owner also sees the other owners in the unfolded row, under "Shared with".

A wish with several owners:

- Each owner sees only their own purchase. When Lotte ticks the board game she shares with Art, Art's page doesn't change. When there aren't enough left, the refusal is the same as on a wish of your own.
- Buyers see one shared state. Mom buying through Art's list and Sis buying through Lotte's list see the same total, the same names and the same notes.
- A wish taken off a list stays on that list for logged-in people who own neither the wish nor the list, marked "Taken off the list", for as long as anyone has a purchase on it. They can lower or withdraw their own purchase there and write notes, but not buy more. The list's owners and the wish's owners never get that row.
- Someone who stops owning a wish (by taking it off their list, leaving a list or being unlinked) is a buyer of it again wherever they can still open a list that shows it, and sees its purchases and notes there.

The page shows whatever the API returned, so the HTML that Nuxt renders on the server can't contain more than the person may see.

Every request about a wish goes through a list link: the URL names the list's token, and the wish must be on that list now (`wishOnList` in `server/domain/placement.ts`). A wish's number alone gives no access. Lowering or withdrawing a purchase and writing a note also work on a wish that left the list; buying more there answers `wish_removed`. A few requests name no list. Deleting your own note and dismissing your own notice go by a random id, and only their owner gets anything but "not found". A share link goes by its own token.

An owner can tick their own wish. Before every tick or higher number the site asks "You might find out that someone already got this. Continue?"; unticking and lowering don't ask. When not enough are left, the owner reads "Someone already has this" or "There aren't that many left" and nothing is recorded. The server answers with a code only, so the refusal names nobody and gives no number. The owner's row never says how many are left, and its + is always enabled.

Rules that keep an owner from finding out by a detour:

- Taking a wish off your list ("Delete" or "Remove from my list") always answers 204, whatever buyers did. A wish nobody owns any more is marked deleted; its row and image stay. Buyers who bought it still see it, marked as taken off.
- Lowering an amount below what is bought is always accepted. Buyers then see that none are left.
- Deleting a list takes every wish off it the same way. After that its owners and logged-out visitors get "not found", whatever was bought; buyers still see what they bought on it. A list with more than one owner can't be deleted, whatever is on it.
- Linking, copying, unlinking, undo, share links and leaving a list never read purchases or notes, so they answer the same whatever was bought. An already bought wish can be linked or copied like any other.
- Notices are about who owns what: a wish linked or unlinked, wishes made joint through a link, a new co-owner. Buying, ticking and writing notes never make one. Neither does a copy, by button or by link: it changes nothing for the owners of the original.
- Buying and writing notes never change a wish's `updatedAt` or its place in the list.
- An owner of a wish or of the list gets a fixed 403 when they try to write a note on it, also on a wish they took off. Deleting a note that isn't yours answers "not found", the same as a note that doesn't exist.
- Pages and API answers are sent with `Cache-Control: private, no-store`. Logging in and out reloads the page.
- Note ids are random, so a gap in a sequence can't hint at notes written elsewhere.

Only `purchases.ts`, `notes.ts` and `list-view.ts` in `server/domain/` read purchases or notes. Tests read the sources of the files behind wishes, lists, placements, sharing, undo, links and notices to keep it that way.

`test/visibility.test.ts` builds two databases that differ only in what buyers, and the other owners of a joint wish, did. It checks that each owner and a visitor get identical results from both. An owner's own purchase is the one difference, and only that owner sees it.

One limit: an owner can register a second account and open their own list as a buyer. Nothing in the code can stop that.

## Deploy on a Raspberry Pi

The Pi needs a 64-bit OS (`uname -m` says `aarch64`) and Docker.

```sh
git clone <this repo> pakske && cd pakske
cp .env.example .env
openssl rand -base64 32        # paste the output into .env as NUXT_APP_SECRET
docker compose up -d --build
```

The site listens on port 3000. Data lives in the Docker volume `pakske-data`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NUXT_APP_SECRET` | none, required | Seals the login cookies. At least 32 characters. The server refuses to start without it. Changing it logs everyone out. |
| `NUXT_SESSION_COOKIE_SECURE` | `true` | The login cookie is only sent over HTTPS. Set `false` only when you open the site as plain `http://` on your home network; otherwise logging in silently fails there. |
| `NUXT_TRUST_PROXY` | `false` | Set `true` behind a tunnel or reverse proxy, so the rate limits see each visitor's own address. Leave `false` when the port is reached directly. |
| `NUXT_MAX_USERS` | `200` | Registration closes at this many accounts. |
| `NUXT_FIREBASE_API_KEY` | none, required | The Web API key of your Firebase project. Firebase Authentication holds the passwords and sends the mails. Without it nobody can log in. |
| `NUXT_FIREBASE_AUTH_EMULATOR_HOST` | empty | `host:port` of the Firebase emulator, to try logging in locally without the real project. |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID` | empty | With the two below: offers "Doorgaan met Google". Empty: email and password only. |
| `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` | empty | The secret of that OAuth client. |
| `NUXT_OAUTH_GOOGLE_REDIRECT_URL` | empty | The site's address followed by `/auth/google`, the same as the authorised redirect URI at Google. |
| `PORT` | `3000` | The port on the host. |

### Logging in: Firebase

Firebase Authentication (Google's) holds the passwords and the Google logins, and sends the mails: a forgotten password, and a password for someone who only used Google. The site talks to Firebase from the server; the browser only ever talks to the site, and the login cookie stays the site's own.

1. At https://console.firebase.google.com, make a project (Analytics isn't needed).
2. Under Build → Authentication → Sign-in method, turn on Email/Password. Under Settings → User account linking, keep "Link accounts that use the same email".
3. Under Settings → Authorised domains, add the site's address, so the mail's button leads back to the login page.
4. Under Templates, set the template language to Dutch, and paste in the sender's name, subject and message from `docs/mails/` (its README says what goes where).
5. Under Project settings → General, copy the Web API key into `.env` as `NUXT_FIREBASE_API_KEY`, and run `docker compose up -d`.

The free plan sends 150 password mails a day.

Accounts from before Firebase move there one by one: the first time someone logs in with their old password, the site makes their Firebase account with that same password. Until then, `scripts/reset-password.mjs` still works for them.

### Logging in with Google

Google goes through Firebase too, so do the steps above first.

1. In the Firebase console, under Authentication → Sign-in method, turn on Google. Firebase makes an OAuth client for it in the same Google Cloud project.
2. At https://console.cloud.google.com, in that project, under APIs & Services → Credentials, open "Web client (auto created by Google Service)". Add `https://<your address>/auth/google` as an authorised redirect URI.
3. Put that client's ID and secret in `.env`, with that same URI as `NUXT_OAUTH_GOOGLE_REDIRECT_URL`, and run `docker compose up -d`.

Someone who logs in with Google for the first time gets an account without a password, named as at Google; Settings mails them a link if they want a password too. An account that already has their address logs in with its password and links Google under Settings. When that address was never confirmed, Firebase lets Google take the account over and drops its password: Google has shown the address is theirs. "Wachtwoord vergeten" gives them a password again.

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

#### Coming from the name "wishlist"

The site used to be called wishlist, and so were its Docker service and volume. Updating past the rename starts an empty site in a new volume, `pakske_pakske-data`, unless you copy the old one over once. Stop the old site before you pull, while the old `compose.yaml` is still there:

```sh
docker compose down
git pull
docker volume ls | grep wishlist     # the old volume, usually wishlist_wishlist-data
docker compose build
docker compose run --rm -u root -v wishlist_wishlist-data:/from:ro pakske sh -c 'cp -a /from/. /data/'
docker compose up -d
```

On its first start the server renames `wishlist.db` to `pakske.db`. Once the site works, `docker volume rm wishlist_wishlist-data` removes the old volume. The folder you cloned into can keep its old name: `compose.yaml` names the project itself.

A database made by the first version, from before private lists, can't be upgraded: the server stops at start with a "table already exists" error. Remove the old database and its `-wal` and `-shm` files from the data folder (in Docker, the volume `pakske-data`) and start again. Accounts and wishes from the first version are not carried over.

```sh
docker compose down
docker compose run --rm -u root pakske sh -c 'rm -f /data/pakske.db* /data/wishlist.db*'
docker compose up -d --build
```

### Back up

Everything is in the volume: `pakske.db` and the `uploads/` folder. This copies both into `backup/` while the site keeps running:

```sh
mkdir -p backup
docker compose exec pakske rm -f /data/backup.db
docker compose exec pakske node -e "new (require('node:sqlite').DatabaseSync)('/data/pakske.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp pakske:/data/backup.db backup/pakske.db
docker compose cp pakske:/data/uploads backup/
```

### Restore

Stop the site, put the files back as the user the server runs as, and start it again:

```sh
docker compose down
docker compose run --rm -u root -v "$PWD/backup:/backup:ro" pakske sh -c \
  'rm -f /data/pakske.db-wal /data/pakske.db-shm && cp /backup/pakske.db /data/pakske.db && mkdir -p /data/uploads && cp -r /backup/uploads/. /data/uploads/ && chown -R node:node /data'
docker compose up -d
```

The two `rm`'d files are SQLite's journal. Left in place after a power cut, they would be replayed over the restored database.

### Someone forgot their password

"Wachtwoord vergeten?" on the login page: Firebase mails a link to choose a new one. For an account from before Firebase that hasn't logged in since, give it a new password by hand:

```sh
docker compose exec pakske node scripts/reset-password.mjs mom@example.com
```

It prints a random password. The person logs in with it and picks their own under Settings.

## How it is put together

```text
app/            pages, components and composables (the Vue side)
  assets/css/   main.css imports Gesso; theme.css is generated; app.css holds the app's own styles
  pages/        index.vue is the home page, lists.vue all your lists, l/[token].vue a list, j/[token].vue a share link
  plugins/      gesso.client.ts registers Gesso's custom elements in the browser
i18n/locales/   nl.json and en.json
server/
  api/          the HTTP API; requests about a wish are under lists/[token]/wishes/, share links under invites/
  db/           schema and migrations (Drizzle, SQLite)
  domain/       the rules, as plain functions that take a database; no Nuxt in here
  middleware/   01.security.ts: cache headers, origin check, body size limits
  routes/       uploads/: serves the pictures
  utils/        database handle, HTTP helpers, rate limiter, uploads, the cookie of opened lists
shared/
  schemas/      zod schemas for what comes in and what goes out
  utils/        the words on a row and on a notice, the order of the rows, what a tick may do and what an edit sends, the search over lists, shared by the page and the tests
test/           unit tests and the API check
```

- **Accounts**: Firebase Authentication holds the passwords and the Google logins (`server/domain/accounts.ts`, through its REST API in `server/utils/firebase.ts`); `users.firebase_uid` ties an account here to the one there. `nuxt-auth-utils` keeps the session in a sealed cookie, with Firebase's refresh token on its server-only side, for what Settings asks of Firebase. Registering asks for a name, an email address and a password. The cookie holds the account's id and the moment the account was made; a cookie whose account is gone, or whose id now belongs to another account (after a restore, say), logs nobody in, for the API and the page alike (`sessionBelongsTo` in `server/domain/users.ts`).
- **Lists**: a list has a title, one or more owners (`list_owners`) and a token of 16 random bytes in base64url, made by `newListToken` in `server/domain/tokens.ts`. The token is the list's address, `/l/<token>`, and the only way in: no page lists other people's lists. Owners rename a list (the address stays). A list with one owner can be deleted; with more, each owner can leave it and the last one deletes it. Both are in the edit mode of the list, which "Edit" in its title band starts.
- **Placements**: `list_wishes` says which lists show a wish. Taking a wish off a list sets `removed_at` on its placement and keeps the row. One rule in `server/domain/placement.ts` covers every way a wish leaves a list (deleting a wish or a list, unlinking, undo): `takeOffList`, which ends with `settleOwners`. `settleOwners` is the only code that writes `wish_owners`: it makes a wish's owners the owners of the live lists that show it, and marks a wish deleted when nobody owns it any more. Leaving a list calls `settleOwners` directly. Each placement has a join order that only goes up, so the site knows who had a wish first. Each placement also has a position: a list shows its wishes by position, the same for everyone, and only its owners change it. A wish that arrives or comes back goes to the bottom; the copy an unlink leaves takes the original's place.
- **Together and Copy**: on a wish on someone else's list, "Add to my list" asks which of your lists it goes on (the one used last is chosen) and offers two buttons (`server/domain/sharing.ts`). Together ("Samen"; `linked` in the code) puts the same wish on your list: you own it at once, stop seeing who buys it, and its earlier owners get a notice with Undo. Copy makes a new wish of your own with the same title, text, link, picture and amount; nobody is told. Either can make a new list on the way. Every copy is made by `copyWishOnto`, also the ones a share link gives and the one an unlink leaves.
- **Unlink**: an owner can unlink anyone who became an owner after them; someone who joined later can only take the wish off their own list. Owners of one list can't unlink each other. The wish doesn't change. The unlinked person gets, on each of their lists that showed it, a plain copy in the same place, without purchases, and a notice. Purchases stay on the original, theirs included.
- **What a link remembers**: when a linker changes a field (title, text, link, amount, picture), their link remembers what it held before their first change, in `link_changes` (`recordChanges` in `server/domain/undo.ts`). When anyone else changes that field later, every other link forgets it, so undo never takes back a newer change. Undo puts the remembered fields back, unlinks the linker, and removes the link and every notice about it. When the last notice about a link is dismissed, the link and what it remembered are deleted; from then on the changes are simply the wish.
- **Share links**: an owner ticks wishes in the list's edit mode and presses "Share", or presses "Manage list together" in the title band, and gets a link `/j/<token>` (`server/domain/invites.ts`). Its token is made like a list token and is never the list's. The link needs a login. For wishes, the owner first chooses how to share. Copy, the default: everyone who opens the link gets copies of their own, once per account, for 30 days; the originals stay their owners' alone and nobody is told. Together: whoever opens it becomes an owner of the wishes, the maker gets a notice, and the link works once. Either way the person who opens it sees the wishes with a box each, unticks the ones they don't want, and chooses one of their lists (or a new one). A wish they own already can't be shared with them again, but can be copied. A link for the list makes whoever opens it a co-owner of the whole list, works once, and tells every earlier owner. A link closes when its list is deleted, when its maker no longer owns the list, when none of its wishes is on the list any more, and, if it works once, when it is used. A link holds at most 50 wishes; a list has at most 20 open links (unused ones, and copy links that haven't expired), and making one more drops the oldest.
- **Joint lists**: a co-owner owns the list and every wish on it, those already there and those added later, and finds it under "Your lists", which names the other owners. Leaving takes away the list and every wish on it that isn't also on another list of yours (`leaveList` in `server/domain/lists.ts`). The last owner can't leave (`last_owner`); a list with more than one owner can't be deleted (`list_shared`).
- **Notices** (`server/domain/notices.ts`): someone linked a wish of yours (with Undo), you were unlinked from a wish, someone used your link and now shares wishes with you, someone became a co-owner of your list. They are on the home page under "Notices", with Dismiss, and View when one of your lists shows what it is about. While some are new, the header has a mark on the site's name, which leads to the home page; opening the home page counts as having seen them.
- **Remembered lists**: opening someone else's list puts it under "Visited". Logged in, that is a row in `list_visits`. Logged out, its token goes into the `opened-lists` cookie (at most 50). A cookie and not local storage, because the server builds the pages. Logging in or registering moves the cookie's lists into the account and clears the cookie. "Remove" only takes a list off your visited lists; the link keeps working. Opening a list of your own writes the same row, and only orders your own lists: the one you opened or joined last comes first (`listOwnedLists` in `server/domain/lists.ts`). It is never shown as visited while you own it; a list you left is under "Visited" only if you opened it yourself. Nobody sees who opened their list.
- **The home page and the lists page**: the home page shows the five most recent lists of your own and the five most recent visited ones (`GET /api/home`), each with a link to the rest. `/lists` has all of them (`GET /api/lists`) as two tabs, "My lists" and "Visited", and one search field that filters both in the browser, on a list's title and its owners' names, whatever the capitals and accents (`shared/utils/list-search.ts`). The tab and the search are in the address (`?tab=visited&q=…`). Logged out it shows only the lists this browser opened. Neither page can show a list you don't own and never opened.
- **Amounts**: a wish has a whole number or no limit (`quantity` is `NULL`). Adding one takes only a title; the amount starts at one. Each person has one purchase per wish with their own number, whichever list they bought it through. `setPurchase` in `server/domain/purchases.ts` checks the total in one synchronous transaction, so two buyers can't both take the last one.
- **Images**: the browser scales a picture to at most 1600 pixels and re-encodes it as JPEG before uploading (`app/composables/useImageResize.ts`). The server checks the size (3 MB) and the first bytes of the file, and stores it under a random name. A copy shares its picture's file with the original, and a link keeps a replaced picture while it may still put it back. A file is removed only when no wish, deleted or not, and no link uses it any more (`unusedImages` in `server/domain/undo.ts`).
- **Limits**: 200 lists ever and 50 at once per person; 500 wishes ever and 200 at once per list. They also count lists made by "Add to my list" and share links, and wishes put on a list by linking, copying or a link. The copy an unlink leaves is not counted, so unlinking never fails.
- **Languages**: Dutch at `/…`, English at `/en/…`. The server answers with error codes; the words are in the locale files under `errors` and `fields`.
- **Guard rails**: five wrong passwords lock an account for fifteen minutes, registration is limited per address, and requests that change something are refused when they come from another site. A tab that comes back into view checks who is logged in and reloads if that changed (`app/plugins/session-watch.client.ts`).

## Gesso

Gesso is installed from git, pinned to a tag in `package.json`. The theme "Ribbon" is this project's own: three pigments in `theme.json`, built by `pnpm theme`.

Things to know when changing the UI:

- The components need the DOM, so they are only imported in `app/plugins/gesso.client.ts`. The server sends plain HTML and the elements upgrade it. `app.css` styles buttons before they upgrade, so the page doesn't jump.
- Every page starts with a band in the deep paint (`PageHead.vue`, or the hero on the home page). `<art-header>` takes its paint from the first band.
- `<art-header>` reads its children and attributes once. To change it, change the element's `key`. It also copies each link's text into its scroll repaint, which is why the mark for new notices is an empty element with an `aria-label` and not hidden text.
- Pass boolean attributes as `value || undefined`. Vue renders `false` as `wet="false"`, which Gesso reads as present.
- `<art-signature>` writes its text into `innerHTML`. It only gets fixed text.
- The words inside `<art-scheme>` (System, Light, Dark) and the header's "Menu" come from Gesso and are English in both languages.

`app.css` marks the blocks that fill gaps in Gesso as candidates to move there: among them the rows of a list, the rows that unfold, the tick box and stepper, the + row that turns into the new row, the small picture with its painted study, text edited where it is read (`.inline-edit`, used for an owner's wish and a list's title), the amount with its stepper and switch, the picture that is its own control, the choice of a list with every list on view, the bar for choosing wishes in edit mode, the single-use link, and the mark in the header.

## Not included

- Email of the site's own: Firebase mails only a forgotten password. Notices stay inside the site, and an address isn't confirmed.
- Fetching a title or picture from a pasted shop link.
- Prices, restoring a deleted wish.
- Seeing who opened your list, or taking a list away from someone who has the link.
- Withdrawing a share link. One keeps working until it is used, expires or closes; making 20 newer ones on the same list drops it.
- Telling anyone when someone leaves a list.

Known consequences of joint wishes, accepted in the design:

- Anyone who is logged in and can open your list can link one of your wishes and then, as an owner, change it. The notice's Undo puts their changes back and unlinks them.
- Once you no longer own a joint wish, you are a buyer of it again wherever you can open a list that shows it, so you then see who bought it. It is no longer your wish.
