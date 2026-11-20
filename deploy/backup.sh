#!/usr/bin/env bash
# Backup for the Raspberry Pi. A systemd timer runs this once a night.
# It copies the database while the site keeps running, and sends that copy, the uploaded
# pictures and the settings file to a restic repository. restic encrypts everything on the Pi
# with the password in ~/.config/pakske-backup.env, so whoever stores the repository can't read
# it. Backups older than 30 days are removed.
#
#   deploy/backup.sh               back up now
#   deploy/backup.sh restic ...    run restic on the repository with the same settings, such as
#                                  `deploy/backup.sh restic snapshots`. Restoring: docs/deploying.md
set -euo pipefail
# what this writes holds everyone's data and the site's secrets
umask 077

ENV_FILE="${ENV_FILE:-$HOME/.config/pakske.env}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$HOME/.config/pakske-backup.env}"
STATE_DIR="${STATE_DIR:-$HOME/.local/share/pakske}"
KEEP_DAYS=30
# One name for every machine the site ever runs on. restic sorts backups by host, and a new Pi
# after a dead SD card has to go on where the old one stopped.
BACKUP_HOST=pakske

say() { echo "$(date '+%F %T') $*"; }
fail() {
  say "BACKUP FAILED: $1"
  exit 1
}
# For what trying again won't mend: the settings. pakske-backup.service tries a failed backup
# again after ten minutes, since the network may have been away, but not one that ends this way.
unset_up() {
  say "BACKUP FAILED: $1"
  exit 2
}

[ -r "$BACKUP_ENV_FILE" ] || unset_up "no settings at $BACKUP_ENV_FILE; copy deploy/backup-env.example there and fill it in"
# Each line is NAME=value and the value is taken as written, as Node takes ~/.config/pakske.env:
# no quotes, and nothing in it is run.
while IFS= read -r line; do
  case "$line" in
    [A-Z]*=*) export "${line%%=*}=${line#*=}" ;;
  esac
done < "$BACKUP_ENV_FILE"
[ -n "${RESTIC_REPOSITORY:-}" ] || unset_up "RESTIC_REPOSITORY is empty in $BACKUP_ENV_FILE"
[ -n "${RESTIC_PASSWORD:-}${RESTIC_PASSWORD_FILE:-}" ] || unset_up "RESTIC_PASSWORD is empty in $BACKUP_ENV_FILE"
case "$RESTIC_REPOSITORY" in
  *'<'*) unset_up "RESTIC_REPOSITORY in $BACKUP_ENV_FILE still has a <placeholder> in it" ;;
  s3:*) [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] || unset_up "the bucket's keys are empty in $BACKUP_ENV_FILE" ;;
esac

# restic at the version deploy/restic-version names, checked against the checksum written there too.
read -r restic_version restic_sha < "$(dirname "$0")/restic-version"
restic="$STATE_DIR/restic/restic-$restic_version"
if [ ! -x "$restic" ]; then
  say "Installing restic $restic_version"
  file="restic_${restic_version}_linux_arm64.bz2"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/$file" "https://github.com/restic/restic/releases/download/v$restic_version/$file" || fail "could not download restic $restic_version"
  echo "$restic_sha  $tmp/$file" | sha256sum -c --quiet || fail "restic $restic_version did not match its checksum"
  mkdir -p "$STATE_DIR/restic"
  bunzip2 -c "$tmp/$file" > "$restic.new"
  chmod +x "$restic.new"
  mv "$restic.new" "$restic"
  rm -rf "$tmp"
fi

if [ "${1:-}" = "restic" ]; then
  shift
  exec "$restic" "$@"
fi

# one backup at a time
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/backup.lock"
flock -n 9 || fail "another backup is still running"

data_dir="$(sed -n 's/^NUXT_DATA_DIR=//p' "$ENV_FILE")"
[ -f "$data_dir/pakske.db" ] || fail "no database at $data_dir/pakske.db (NUXT_DATA_DIR in $ENV_FILE)"

# The copy of the database goes here first. It holds everyone's data, so only this user reads it.
staging="$STATE_DIR/backup"
mkdir -p "$staging"
chmod 700 "$staging"
rm -f "$staging/pakske.db"

# VACUUM INTO writes one complete file while the site keeps running. Copying pakske.db itself
# would miss whatever is still in the journal beside it (pakske.db-wal), which can be all of it.
# Pakske's own Node does it: the Pi has no sqlite3 command.
"$STATE_DIR/node/current/bin/node" --no-warnings - "$data_dir/pakske.db" "$staging/pakske.db" > "$staging/accounts" <<'JS' || fail "could not copy the database"
const { DatabaseSync } = require('node:sqlite')
const [from, to] = process.argv.slice(2)
const live = new DatabaseSync(from)
live.exec('PRAGMA busy_timeout = 5000')
live.exec(`VACUUM INTO '${to.replaceAll("'", "''")}'`)
live.close()
const copy = new DatabaseSync(to, { readOnly: true })
const state = copy.prepare('PRAGMA integrity_check').get().integrity_check
if (state !== 'ok') throw new Error(`the copy is damaged: ${state}`)
console.log(`${copy.prepare('select count(*) as n from users').get().n} accounts`)
JS
mkdir -p "$data_dir/uploads"

# A repository that doesn't exist yet is made on the first run. Anything else that goes wrong
# here, such as a wrong password or wrong keys, stops the backup.
status=0
"$restic" cat config > /dev/null 2>"$staging/restic.err" || status=$?
if [ "$status" = 10 ]; then
  say "Making the repository at $RESTIC_REPOSITORY"
  "$restic" init > /dev/null || fail "could not make the repository"
elif [ "$status" = 12 ]; then
  unset_up "RESTIC_PASSWORD in $BACKUP_ENV_FILE is not this repository's password"
elif [ "$status" != 0 ]; then
  fail "could not open the repository: $(tail -n 1 "$staging/restic.err")"
fi

"$restic" backup --quiet --host "$BACKUP_HOST" "$staging/pakske.db" "$ENV_FILE" "$data_dir/uploads" || fail "restic backup stopped with status $?"

# Something a person deleted stays in a backup until that backup is removed, as the privacy page
# says. Thirty days is long enough to notice a mistake and short enough to keep that promise.
"$restic" forget --quiet --host "$BACKUP_HOST" --keep-within "${KEEP_DAYS}d" --prune || fail "could not remove old backups"
# reads the repository back and compares it with its own index
"$restic" check --quiet || fail "the repository did not pass restic's check"

snapshots="$("$restic" snapshots --host "$BACKUP_HOST" --json | "$STATE_DIR/node/current/bin/node" -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).length')"
say "Backed up: $(cat "$staging/accounts"), $(find "$data_dir/uploads" -type f | wc -l | tr -d ' ') pictures. Backups in the repository: $snapshots."
