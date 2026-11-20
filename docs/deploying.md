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
| `NUXT_PUBLIC_OPERATOR_BACKUPS` | empty | The company that stores the nightly backups `deploy/backup.sh` makes, such as `Cloudflare`. The privacy page then names it and says a backup is kept 30 days. |
| `PORT` | `3000` | The port on the host. |

## Logging in: Firebase

Firebase Authentication (Google's) holds the passwords and the Google logins, and sends the mails: a forgotten password, a password for someone who only used Google, and the link that confirms a new email address. The site talks to Firebase from the server; the browser only ever talks to the site, and the login cookie stays the site's own.

1. At https://console.firebase.google.com, make a project (Analytics isn't needed).
2. Under Build → Authentication → Sign-in method, turn on Email/Password. Under Settings → User account linking, keep "Link accounts that use the same email".
3. Under Authentication → Settings → Password policy, set the minimum length to 8 and require enforcement. The site asks for 8 characters itself, also on the page a password mail opens. Until step 6 is done that page is Firebase's own, and without this it takes 6.
4. Under Settings → Authorised domains, add the site's address, so the mail's button leads back to the login page.
5. Under Templates, set the template language to Dutch, and paste in the sender's name, subject and message from `docs/mails/` (its README says what goes where). If the console answers that template updates are unavailable for the project, only Firebase support can change that; the mails then go out in Firebase's own words.
6. Under Templates, open any template with the pencil, press "customize action URL" and fill in `https://<the site's address>/auth/action`. It counts for every template. From then on the link in a mail opens the site's own page for it (see [The page behind a mail's link](#the-page-behind-a-mails-link)). It is saved like a template, so a project that can't change its templates may be refused this too; the mails then keep opening Firebase's page, which works as before.
7. Under Project settings → General, set the public-facing name to the site's name. Firebase's own mails use it.
8. Under Project settings → General, copy the Web API key into `.env` as `NUXT_FIREBASE_API_KEY`, and run `docker compose up -d`. A new project may not show the key there; it is then at https://console.cloud.google.com, in that project, under APIs & Services → Credentials, as "Browser key (auto created by Firebase)".

The free plan sends 150 password mails a day.

Under Settings someone can ask for another email address. Firebase mails the new address a link, and the address changes at Firebase when that link is clicked; a typo can't lock anyone out. The site takes the new address over the next time it hears from Firebase about the account: at a login, or when Settings is opened. Until then Settings shows the old one. A link that opened the site's own page changes the address here in the same step. When Firebase has ended the account's logins because of the change, a browser that was still logged in keeps working, but Settings there answers "log out and in again" to anything that needs Firebase.

### The page behind a mail's link

`/auth/action` is the page for the links in Firebase's mails, once step 6 points them there. Firebase adds to the address what the link is for (`mode`), a one-time code (`oobCode`) and the language the mail was asked in (`lang`); a mail asked for in English opens `/en/auth/action`. The page covers the four links Firebase mails:

- **A new password** (`resetPassword`): a field for the password, at least 8 characters. Saving it logs the person in.
- **Confirming an address** (`verifyEmail`). The site never sends this mail; the page is there for when Firebase does.
- **A new address** (`verifyAndChangeEmail`): the link mailed to the new address from Settings.
- **The old address back** (`recoverEmail`): the link mailed to the old address after a change. Afterwards the page offers a mail for a new password, for when someone else made the change.

Opening the page only reads the code (`GET /api/auth/mail-link`) and says what the link will do. It happens when the person presses the button (`POST /api/auth/mail-link`), so a mail program that opens links to scan them uses nothing up. A code works once; after that, and for an expired or made-up one, the page says the link no longer works.

Deleting an account under Settings deletes it at Firebase first and then here. Firebase only does that, and only mails a new address, for a login of the last few minutes: with a password the site logs in again on the spot, and someone who only uses Google is asked to log out and in first.

Accounts from before Firebase move there one by one: the first time someone logs in with their old password, the site makes their Firebase account with that same password. Until then, `scripts/reset-password.mjs` still works for them.

## Logging in with Google

Google goes through Firebase too, so do the steps above first.

1. In the Firebase console, under Authentication → Sign-in method, turn on Google. Firebase makes an OAuth client for it in the same Google Cloud project.
2. At https://console.cloud.google.com, in that project, under APIs & Services → Credentials, open "Web client (auto created by Google Service)". Add `https://<your address>/auth/google` as an authorised redirect URI.
3. Put that client's ID and secret in `.env`, with that same URI as `NUXT_OAUTH_GOOGLE_REDIRECT_URL`, and run `docker compose up -d`. Google shows a secret only when it is made: press "Add secret" on the client's page for one you can copy. The one Firebase made stays, and Firebase keeps using it.

Someone who logs in with Google for the first time gets an account without a password, named as at Google; Settings mails them a link if they want a password too. An account that already has their address logs in with its password and links Google under Settings. When that address was never confirmed, Firebase lets Google take the account over and drops its password: Google has shown the address is theirs. "Wachtwoord vergeten" gives them a password again.

Delete accounts under Settings on the site, not in the Firebase console: the console leaves the account here behind, with an id Firebase no longer knows. Someone with Google gets back in anyway, because their next login makes a new Firebase account and the account here follows it by its Google account (`movedAtFirebase` in `server/domain/accounts.ts`). An account with only a password stays locked out until its new Firebase id is written into `users.firebase_uid`.

### A second project for development

The accounts you make while working on the site don't belong among the real ones. Make a second Firebase project for your own machine and put its key and OAuth client in the `.env` there. It needs steps 1 to 3 of the Firebase steps and, for Google, the three above with `http://localhost:3400/auth/google` as the redirect URI. `localhost` is already among its authorised domains.

A database goes with the project its accounts were made in. An account here is tied to its Firebase account by Firebase's id (`firebase_uid`), and another project gives the same address another id. With a database that already has accounts, a different key leaves them unable to log in: Firebase doesn't know them, and registering again is refused because the address is taken here. Start the other project with an empty database, or make the accounts there and write their new ids into `users.firebase_uid`.

To reach the site from outside your home, put HTTPS in front of it: a Cloudflare Tunnel, Tailscale Funnel, or Caddy with a port forward. In that case:

- keep `NUXT_SESSION_COOKIE_SECURE=true`;
- set `NUXT_TRUST_PROXY=true`. Otherwise every visitor seems to come from the proxy's address, and the limits on wrong passwords and on new accounts count for everyone together.

The server expects exactly one proxy in front and takes the visitor's address from the last entry of `X-Forwarded-For`.

With both settings on, a visitor the proxy says came over plain `http://` (its `X-Forwarded-Proto`) is sent to the same page over `https://`, and HTTPS answers carry `Strict-Transport-Security` for half a year. A Cloudflare Tunnel answers on both, and the login cookie only travels over HTTPS, so on the `http://` address a logged-in person would look logged out.

## The privacy page and the terms

The site has a privacy page at `/privacy` and terms at `/terms`, linked from every page's footer and from the form that makes an account. They describe what Pakske does with people's data, which is the same wherever it runs, and they name you as the one who runs it. Before you let people in:

- set `NUXT_PUBLIC_OPERATOR_NAME` and `NUXT_PUBLIC_OPERATOR_EMAIL`. Under the GDPR people must be able to tell who keeps their data and where to ask for it;
- set `NUXT_PUBLIC_OPERATOR_NETWORK` if a company's tunnel or proxy sits in front, since it sees every visitor's address;
- set `NUXT_PUBLIC_OPERATOR_BACKUPS` if the backups go to a company, as with [Backing up from the Pi](#backing-up-from-the-pi). The sentence says they are encrypted before they leave the server and kept 30 days, which is what `deploy/backup.sh` does; change it if yours differ;
- read both pages as they come out. They are written for one person running the site for family and friends in the EU, and they are not legal advice. If your site differs (a host outside the EU, a company behind it, logs kept by your proxy), change the sentences in `i18n/locales/` and the date in `privacy.updated` and `terms.updated`.

The privacy page promises an answer within a month to someone who asks for their data. Most of it people do themselves: Settings has a download of everything the site keeps about them and a button that deletes the account, and the server erases a deleted list or wish thirty days later. What is left for you is in [the privacy record](privacy-record.md), with what to do when data leaks.

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

### Backing up from the Pi

`deploy/backup.sh` sends a backup to a [restic](https://restic.net) repository, and `pakske-backup.timer` runs it every night at 03:30. A backup holds the database, the uploaded pictures and `~/.config/pakske.env`. restic encrypts it on the Pi with a password only you have, so whoever stores the repository can't read it. Backups older than 30 days are removed: the privacy page says that something a person deleted stays in a backup until that backup is replaced.

The script installs its own restic, at the version and checksum in `deploy/restic-version`, under `~/.local/share/pakske/restic/`.

The example settings are for a Cloudflare R2 bucket, which is free up to 10 GB. restic also takes a folder on a USB disk, SFTP, Backblaze B2 and others; only `RESTIC_REPOSITORY` and the keys differ.

1. At Cloudflare, under R2 object storage, make a bucket. Under Location, choose the EU jurisdiction. That keeps the backups inside the EU, and it can't be changed once the bucket exists.
2. On R2's Overview page, press Manage beside API Tokens and make a token with "Object Read & Write", for that bucket only. Cloudflare shows its Access Key ID and Secret Access Key once.
3. On the Pi:

```sh
cp ~/pakske/deploy/backup-env.example ~/.config/pakske-backup.env && chmod 600 ~/.config/pakske-backup.env
# fill it in; openssl rand -base64 32 makes RESTIC_PASSWORD
cp ~/pakske/deploy/pakske-backup.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now pakske-backup.timer
~/pakske/deploy/backup.sh
```

The last line makes the first backup, and the repository with it.

Keep a copy of `RESTIC_PASSWORD` somewhere that is not the Pi, such as a password manager. Without it nobody can open the backups, and after a dead SD card the Pi's copy is gone.

The passwords are not in a backup: Firebase holds them. A restored database works with the Firebase project its accounts were made in, and with no other (see [A second project for development](#a-second-project-for-development)).

`tail ~/.local/share/pakske/backup.log` shows what each backup did. A backup that failed starts its line with `BACKUP FAILED` and says why; it is tried again ten minutes later, three times at most, unless the settings are what's wrong. `deploy/backup.sh restic snapshots` lists the backups in the repository; any other restic command works the same way.

To put a backup back, fetch it first. The files come out under `~/pakske-restore` with the paths they had on the Pi:

```sh
~/pakske/deploy/backup.sh restic restore latest --target ~/pakske-restore
pm2 stop pakske
rm -f ~/pakske-data/pakske.db-wal ~/pakske-data/pakske.db-shm
cp ~/pakske-restore/home/$USER/.local/share/pakske/backup/pakske.db ~/pakske-data/pakske.db
mkdir -p ~/pakske-data/uploads && cp -r ~/pakske-restore/home/$USER/pakske-data/uploads/. ~/pakske-data/uploads/
pm2 start pakske
rm -rf ~/pakske-restore
```

`~/pakske-data` stands for `NUXT_DATA_DIR` from `~/.config/pakske.env`. An older backup than the latest: its ID from `restic snapshots` in place of `latest`.

On a new Pi, clone the repository and write `~/.config/pakske-backup.env` again: the repository's address, the password you kept, and the bucket's keys (a new token does as well). Fetch the backup with the first line above and copy `~/pakske-restore/home/$USER/.config/pakske.env` to `~/.config/pakske.env`, in place of filling one in. Set the site up as in the section before this one, and then run the remaining lines above. With the old `NUXT_APP_SECRET` back, everyone is still logged in.

Without restic, backing up and restoring work as below, with `NUXT_DATA_DIR` from `~/.config/pakske.env` in place of the volume, and `pm2 stop pakske` and `pm2 start pakske` in place of `docker compose down` and `up`.

### Knowing when something is down

`deploy/watch.sh` fetches the site every minute at its public address, so through Cloudflare and the tunnel like any visitor, and reports the answer to [healthchecks.io](https://healthchecks.io). The backup and the deploy report there too. healthchecks.io then tells you, by mail or on your phone:

- when the site answers with an error or not at all, two minutes in a row;
- when the reports stop for six minutes: the Pi is off, or has no internet;
- when a night's backup fails or doesn't happen;
- when a deploy fails. The site then stays on the build before it.

It also tells you when each of these is fine again. Its free plan has 20 checks; this uses one for each site you watch and two more. What it gets from the Pi is a check's name, the status the site answered with and how long it took, and the one line the backup or the deploy logs. Nothing about the people who use the site.

1. Make an account at healthchecks.io. Under the project's Settings, copy the ping key, and make a read-write API key.
2. For a message on your phone as well as a mail: install the [ntfy](https://ntfy.sh) app, subscribe to a topic with a name nobody would guess, and add that topic at healthchecks.io under Integrations → ntfy. Anyone who knows the topic's name can read what is sent to it.
3. On the Pi:

```sh
cp ~/pakske/deploy/watch-env.example ~/.config/pakske-watch.env && chmod 600 ~/.config/pakske-watch.env
# fill it in: the two keys, and the address of your site in WATCH_SITES
~/pakske/deploy/watch.sh setup
cp ~/pakske/deploy/pakske-watch.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now pakske-watch.timer
```

`watch.sh setup` makes the checks with their schedules and gives each one every way of telling you that the project has. Run it again after adding a site to `WATCH_SITES` or an integration at healthchecks.io.

`WATCH_SITES` can name other sites on the same Pi, as `name=address` pairs with a space between them. An address counts as up when it answers with a status from 200 to 299.

To see that it works, `pm2 stop pakske`: within three minutes the message arrives, and `pm2 start pakske` brings the one that says it is back.

What the Pi itself keeps:

| File | What is in it |
| --- | --- |
| `~/.local/share/pakske/watch.log` | When a site went down, why, and when it came back. |
| `~/.local/share/pakske/backup.log` | One line for each backup. |
| `~/.local/share/pakske/deploy.log` | Each deploy, with its build. Past a megabyte the oldest half is dropped. |
| `~/.pm2/logs/pakske-error.log` | The site's own errors, each line with its time. A wrong or old link is not one of them. |

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
