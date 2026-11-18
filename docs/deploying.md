# Deploying on a Raspberry Pi

The Pi needs a 64-bit OS (`uname -m` says `aarch64`) and Docker.

```sh
git clone https://github.com/artvandervennet/pakske.git && cd pakske
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
| `NUXT_PUBLIC_OPERATOR_NAME` | empty | Who runs the site: you. Shown on the privacy page and the terms. Empty: they say "the person who runs this site". |
| `NUXT_PUBLIC_OPERATOR_EMAIL` | empty | Where people send questions about their data. Shown on both pages. |
| `NUXT_PUBLIC_OPERATOR_NETWORK` | empty | The company whose tunnel or proxy carries the traffic, such as `Cloudflare`. The privacy page then names it. |
| `PORT` | `3000` | The port on the host. |

## Logging in: Firebase

Firebase Authentication (Google's) holds the passwords and the Google logins, and sends the mails: a forgotten password, a password for someone who only used Google, and the link that confirms a new email address. The site talks to Firebase from the server; the browser only ever talks to the site, and the login cookie stays the site's own.

1. At https://console.firebase.google.com, make a project (Analytics isn't needed).
2. Under Build → Authentication → Sign-in method, turn on Email/Password. Under Settings → User account linking, keep "Link accounts that use the same email".
3. Under Authentication → Settings → Password policy, set the minimum length to 8 and require enforcement. The site asks for 8 characters itself; the page Firebase's mail opens for a new password is Firebase's own, and without this it takes 6.
4. Under Settings → Authorised domains, add the site's address, so the mail's button leads back to the login page.
5. Under Templates, set the template language to Dutch, and paste in the sender's name, subject and message from `docs/mails/` (its README says what goes where). If the console answers that template updates are unavailable for the project, only Firebase support can change that; the mails then go out in Firebase's own words.
6. Under Project settings → General, set the public-facing name to the site's name. Firebase's own mails use it.
7. Under Project settings → General, copy the Web API key into `.env` as `NUXT_FIREBASE_API_KEY`, and run `docker compose up -d`.

The free plan sends 150 password mails a day.

Under Settings someone can ask for another email address. Firebase mails the new address a link, and the address changes at Firebase when that link is clicked; a typo can't lock anyone out. The site takes the new address over the next time it hears from Firebase about the account: at a login, or when Settings is opened. Until then Settings shows the old one. When Firebase has ended the account's logins because of the change, a browser that was still logged in keeps working, but Settings there answers "log out and in again" to anything that needs Firebase.

Deleting an account under Settings deletes it at Firebase first and then here. Firebase only does that, and only mails a new address, for a login of the last few minutes: with a password the site logs in again on the spot, and someone who only uses Google is asked to log out and in first.

Accounts from before Firebase move there one by one: the first time someone logs in with their old password, the site makes their Firebase account with that same password. Until then, `scripts/reset-password.mjs` still works for them.

## Logging in with Google

Google goes through Firebase too, so do the steps above first.

1. In the Firebase console, under Authentication → Sign-in method, turn on Google. Firebase makes an OAuth client for it in the same Google Cloud project.
2. At https://console.cloud.google.com, in that project, under APIs & Services → Credentials, open "Web client (auto created by Google Service)". Add `https://<your address>/auth/google` as an authorised redirect URI.
3. Put that client's ID and secret in `.env`, with that same URI as `NUXT_OAUTH_GOOGLE_REDIRECT_URL`, and run `docker compose up -d`.

Someone who logs in with Google for the first time gets an account without a password, named as at Google; Settings mails them a link if they want a password too. An account that already has their address logs in with its password and links Google under Settings. When that address was never confirmed, Firebase lets Google take the account over and drops its password: Google has shown the address is theirs. "Wachtwoord vergeten" gives them a password again.

To reach the site from outside your home, put HTTPS in front of it: a Cloudflare Tunnel, Tailscale Funnel, or Caddy with a port forward. In that case:

- keep `NUXT_SESSION_COOKIE_SECURE=true`;
- set `NUXT_TRUST_PROXY=true`. Otherwise every visitor seems to come from the proxy's address, and the limits on wrong passwords and on new accounts count for everyone together.

The server expects exactly one proxy in front and takes the visitor's address from the last entry of `X-Forwarded-For`.

With both settings on, a visitor the proxy says came over plain `http://` (its `X-Forwarded-Proto`) is sent to the same page over `https://`, and HTTPS answers carry `Strict-Transport-Security` for half a year. A Cloudflare Tunnel answers on both, and the login cookie only travels over HTTPS, so on the `http://` address a logged-in person would look logged out.

## The privacy page and the terms

The site has a privacy page at `/privacy` and terms at `/terms`, linked from every page's footer, from the form that makes an account, and from the login page when it offers Google. They describe what Pakske does with people's data, which is the same wherever it runs, and they name you as the one who runs it. Before you let people in:

- set `NUXT_PUBLIC_OPERATOR_NAME` and `NUXT_PUBLIC_OPERATOR_EMAIL`. Under the GDPR people must be able to tell who keeps their data and where to ask for it;
- set `NUXT_PUBLIC_OPERATOR_NETWORK` if a company's tunnel or proxy sits in front, since it sees every visitor's address;
- read both pages as they come out. They are written for one person running the site for family and friends in the EU, and they are not legal advice. If your site differs (a host outside the EU, a company behind it, logs kept by your proxy), change the sentences in `i18n/locales/` and the date in `privacy.updated` and `terms.updated`.

The privacy page promises an answer within a month to someone who asks for their data. A deleted list or wish stays in the database, marked as deleted; to erase one for good on request, remove its rows by hand.

## Update

```sh
git pull
docker compose up -d --build
```

New migrations run when the server starts.

### Coming from the name "wishlist"

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

## Without Docker: auto-deploy on the Pi

pakske.vandervennet.art runs this way, beside two other sites on the same Pi. A systemd timer runs `deploy/deploy.sh` every minute. When `main` has a new commit, it pulls, builds, and switches the site over once the new build answers on `/api/health`. The site keeps running from the old build until then, and a build that fails or doesn't answer leaves it there. A commit that failed is not tried again until the next commit, or `deploy/deploy.sh --force`.

The script installs its own Node, at the version and checksum in `deploy/node-version`, under `~/.local/share/pakske/node/`, so the Pi's own Node can stay at what its other sites need. pm2 runs the server from `~/.local/share/pakske/current`, a link to the live build in `releases/`; the three newest builds stay there.

Setting it up, once, as your own user (not root):

```sh
git clone https://github.com/artvandervennet/pakske.git ~/pakske
cp ~/pakske/deploy/env.example ~/.config/pakske.env && chmod 600 ~/.config/pakske.env
# fill it in; openssl rand -base64 32 makes NUXT_APP_SECRET
mkdir -p ~/.config/systemd/user ~/.local/share/pakske
cp ~/pakske/deploy/pakske-deploy.{service,timer} ~/.config/systemd/user/
~/pakske/deploy/deploy.sh --force
systemctl --user daemon-reload && systemctl --user enable --now pakske-deploy.timer
```

pm2 must already start at boot (`pm2 startup`), and the user needs lingering (`loginctl enable-linger`) for the timer to run without anyone logged in. Then point a Cloudflare Tunnel hostname at `http://localhost:3030`.

`tail ~/.local/share/pakske/deploy.log` shows what each deploy did. To go back to an older build by hand: `ln -sfn ~/.local/share/pakske/releases/<commit> ~/.local/share/pakske/current && pm2 reload pakske`.

Backing up and restoring work as below, with `NUXT_DATA_DIR` from `~/.config/pakske.env` in place of the volume, and `pm2 stop pakske` and `pm2 start pakske` in place of `docker compose down` and `up`.

## Back up

Everything is in the volume: `pakske.db` and the `uploads/` folder. This copies both into `backup/` while the site keeps running:

```sh
mkdir -p backup
docker compose exec pakske rm -f /data/backup.db
docker compose exec pakske node -e "new (require('node:sqlite').DatabaseSync)('/data/pakske.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp pakske:/data/backup.db backup/pakske.db
docker compose cp pakske:/data/uploads backup/
```

## Restore

Stop the site, put the files back as the user the server runs as, and start it again:

```sh
docker compose down
docker compose run --rm -u root -v "$PWD/backup:/backup:ro" pakske sh -c \
  'rm -f /data/pakske.db-wal /data/pakske.db-shm && cp /backup/pakske.db /data/pakske.db && mkdir -p /data/uploads && cp -r /backup/uploads/. /data/uploads/ && chown -R node:node /data'
docker compose up -d
```

The two `rm`'d files are SQLite's journal. Left in place after a power cut, they would be replayed over the restored database.

## Someone forgot their password

"Wachtwoord vergeten?" on the login page: Firebase mails a link to choose a new one. For an account from before Firebase that hasn't logged in since, give it a new password by hand:

```sh
docker compose exec pakske node scripts/reset-password.mjs mom@example.com
```

It prints a random password. The person logs in with it and picks their own under Settings.
