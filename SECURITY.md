# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it in private, either way:

- On GitHub: the repository's **Security** tab, then **Report a vulnerability**.
- By mail: <me@vandervennet.art>.

Say what you found, how to reproduce it, and what someone could do with it. One person maintains Pakske, so an answer can take a few days. You will hear when it is fixed, and you are named in the fix if you want to be.

## What counts

Anything that lets someone do or see what they shouldn't. For Pakske that includes, besides the usual:

- **An owner finding out what was bought.** The owners of a wish must never learn who bought it, how many, or what buyers wrote, also not by a detour such as a count, an error, an order or a timestamp. [Who sees what](docs/who-sees-what.md) has the rules.
- **Reaching a list without its link**, or a wish through a list it isn't on.
- **The fetch of a link's cover** (`server/utils/link-cover.ts`) reaching the server's own machine or a private network, or being used to keep the server busy.
- **Accounts**: logging in as someone else, changing their address or deleting their account.

One limit is known and can't be closed in the code: an owner can make a second account and open their own list as a buyer.

## Versions

Only the latest commit on `main` gets fixes. Someone who runs Pakske updates with `git pull` and `docker compose up -d --build`.

## Testing

Test against an instance of your own, never against a site someone else runs.
