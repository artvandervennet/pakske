# The privacy record

The GDPR asks whoever runs a site to keep three things on paper: what the site does with people's data, who else handles it, and what happens when someone asks for their data or when data leaks. The site's privacy page (`/privacy`) tells visitors the first two. This is the same for you, the person who runs the site, with the parts only you can do.

It describes Pakske as [Deploying](deploying.md) sets it up: Firebase for logging in, a Cloudflare Tunnel in front, nightly backups with restic. Where your site differs, change this page and the privacy page together. It is not legal advice.

Last checked on 20 November 2026.

## Who answers for it

You do: the name and address in `NUXT_PUBLIC_OPERATOR_NAME` and `NUXT_PUBLIC_OPERATOR_EMAIL`. A site of this size needs no data protection officer.

## What is kept, why and how long

| What | Why the site may keep it | Until |
| --- | --- | --- |
| Account: name, email address, profile picture, the number of a linked Google account, when it was made | To carry out the agreement with the person (article 6(1)(b)) | The account is deleted |
| Lists and wishes: titles, descriptions, links, pictures | Same | 30 days after their owner deletes them, or deletes the account |
| What someone ticks on other people's lists, and their notes there | Same | They take it back, the wish is erased, or their account is deleted. A note then stays without a name until its wish is erased |
| What someone writes to the owners of a list, and the owners' answers | Same | The writer or an owner deletes it, or the list is erased |
| Visited lists, friends and requests, notices, Secret Santa groups and whose name was drawn | Same | The person removes it, or their account is deleted |
| Links to share wishes or a list, or to become friends | Same | 30 days after the link ran out or was used |
| IP address and typed email address, in the server's memory, to count wrong passwords and new accounts | Legitimate interest: protecting the accounts (article 6(1)(f)) | One hour at most; never written to disk |
| The error log: an error and the address of the page that failed, which can hold a list's link | Legitimate interest: keeping the site working | You clear it: `pm2 flush pakske` |
| Backups: an encrypted copy of the database and the pictures | Legitimate interest: not losing people's lists | 30 days |

The site asks for nothing sensitive, but a title, a note or a message is free text and holds whatever someone types. It builds no profiles, decides nothing about people by itself, and sends no mail other than the ones for a password or a new address. The terms let a child have an account when a parent agrees.

## Who else handles it

| Who | What they get | On what terms |
| --- | --- | --- |
| Google, for Firebase Authentication | Email address, name, password. It sends the mails. It may process this in the United States | The [Firebase Data Processing and Security Terms](https://firebase.google.com/terms/data-processing-terms), which you accepted with Firebase's terms and which include the EU's standard contractual clauses. Google also takes part in the EU–US Data Privacy Framework |
| Cloudflare, for the tunnel | Every request and answer, so also visitors' IP addresses | Cloudflare's data processing addendum, which is part of the agreement you accepted when you made the account |
| Cloudflare, for the R2 bucket | The backups, which restic encrypts on the Pi. Cloudflare can't read them | Same. Choose the EU jurisdiction when you make the bucket; it can't be changed later |
| healthchecks.io | A check's name, a status and a duration, and how many accounts and pictures a backup held | Nothing about a person goes there |

A shop behind a wish's link gets a request from the server, never from a visitor, until that visitor follows the link.

Two things to check once at these companies: that Google Analytics is off for the Firebase project (Pakske doesn't use it), and that the R2 bucket's jurisdiction is the EU.

## When someone asks for their data

Answer within a month. Reply to the email address of their account, so you know it is them.

- **A copy**: Settings has "Download your data", a file with everything the site keeps about them.
- **A correction**: they change their name, address, lists and wishes themselves. Notes and messages can only be deleted and written again.
- **Erasing**: Settings has "Delete account". The lists that were theirs alone go with it, and the server erases those for good 30 days later. Their notes on other people's wishes and what they wrote to the owners of a list stay without a name. Nothing ties those rows to them any more, so to erase one on request you need the list and the words from them; then delete that row from `notes` or `list_messages` by hand.
- **Someone who can't log in** asks for a new password on the login page first. An account you delete in the Firebase console keeps its row here; delete the account from Settings instead, or remove the row from `users` by hand.

Putting a backup back also puts back what was deleted since that backup was made. Accounts deleted in between are in the database again, without a login at Firebase. There is no script that removes them yet: note which accounts were deleted, and remove their rows from `users` after a restore.

## When data leaks

A leak is the Pi stolen or broken into, the database or a backup's password in the wrong hands, or a fault in the site that showed someone what wasn't theirs to see.

1. Stop it. `pm2 stop pakske` takes the site offline. A new `NUXT_APP_SECRET` logs everyone out. Replace whatever key was exposed: the Firebase API key, the R2 token, the restic password.
2. Write down what happened, when you found out, whose data it was and what you did. The GDPR asks for that note also when you report nothing.
3. Within 72 hours of finding out, report it to the data protection authority, unless it is unlikely to put anyone at risk. In Belgium that is the [Gegevensbeschermingsautoriteit](https://www.gegevensbeschermingsautoriteit.be).
4. If it puts people at high risk, tell them yourself, without waiting: what leaked and what they can do.
