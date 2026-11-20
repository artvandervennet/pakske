#!/usr/bin/env bash
# Watches the sites from the Pi. A systemd timer runs this every minute.
# It fetches each site at its public address, so through Cloudflare and the tunnel like any
# visitor, and reports the answer to healthchecks.io. healthchecks.io warns whoever runs the
# site when a site fails, and also when the reports stop: then the Pi is off or offline.
#
#   deploy/watch.sh          fetch every site once and report
#   deploy/watch.sh setup    make the checks at healthchecks.io, or bring their schedules up to date
#
# The settings are in ~/.config/pakske-watch.env: docs/deploying.md, "Knowing when something is down".
set -uo pipefail

STATE_DIR="${STATE_DIR:-$HOME/.local/share/pakske}"
# How long a site gets to answer.
PATIENCE=20
# One slow answer over Wi-Fi is not an outage: a site counts as down from the second miss in a row.
MISSES_BEFORE_DOWN=2

# shellcheck source=deploy/report.sh
. "$(dirname "$0")/report.sh"

say() { echo "$(date '+%F %T') $*"; }

[ -n "${HC_PING_KEY:-}" ] || { say "WATCH FAILED: HC_PING_KEY is empty in $WATCH_ENV_FILE"; exit 2; }
[ -n "${WATCH_SITES:-}" ] || { say "WATCH FAILED: WATCH_SITES is empty in $WATCH_ENV_FILE"; exit 2; }

# name=address pairs, such as pakske=https://pakske.example.com/api/health
sites=()
for site in $WATCH_SITES; do
  case "$site" in
    *[!a-z0-9-]*=* | =* | *'"'* | *\\*) say "WATCH FAILED: \"$site\" in WATCH_SITES is not name=address, with a name of a-z, 0-9 and -"; exit 2 ;;
    *=http://* | *=https://*) sites+=("$site") ;;
    *) say "WATCH FAILED: \"$site\" in WATCH_SITES is not name=address"; exit 2 ;;
  esac
done

if [ "${1:-}" = "setup" ]; then
  [ -n "${HC_API_KEY:-}" ] || { say "HC_API_KEY is empty in $WATCH_ENV_FILE: setup needs the project's read-write API key"; exit 2; }
  failed=0
  # make <slug> <description> <the schedule, as JSON fields>
  make() {
    local body status
    body="$(printf '{"name":"%s","slug":"%s","desc":"%s",%s,"channels":"*","unique":["slug"]}' "$1" "$1" "$2" "$3")"
    status="$(curl -sS -m 20 -o /tmp/pakske-watch-setup.$$ -w '%{http_code}' -H "X-Api-Key: $HC_API_KEY" -H 'Content-Type: application/json' \
      --data-raw "$body" "${HC_API_URL:-https://healthchecks.io/api/v3}/checks/")" || status=000
    case "$status" in
      201) echo "made     $1" ;;
      200) echo "updated  $1" ;;
      *) echo "FAILED   $1: $status $(head -c 200 /tmp/pakske-watch-setup.$$ 2>/dev/null)"; failed=1 ;;
    esac
    rm -f /tmp/pakske-watch-setup.$$
  }
  # A site reports every minute. Five minutes without a report and it counts as down.
  for site in "${sites[@]}"; do
    make "${site%%=*}" "Fetched from the Pi every minute: ${site#*=}" '"timeout":60,"grace":300'
  done
  # The backup runs at 03:30 and may try again for a while: deploy/pakske-backup.timer.
  make pakske-backup "deploy/backup.sh, every night at 03:30" "\"schedule\":\"30 3 * * *\",\"tz\":\"$(timedatectl show -p Timezone --value 2>/dev/null || echo UTC)\",\"grace\":10800"
  # A deploy comes when there is something to deploy, so only a failed one counts as down.
  make pakske-deploy "deploy/deploy.sh, at every new commit on main" '"timeout":31536000,"grace":3600'
  exit "$failed"
fi

mkdir -p "$STATE_DIR/watch"

check() {
  local name="${1%%=*}" address="${1#*=}" answer code seconds misses why
  answer="$(curl -s -o /dev/null -m "$PATIENCE" -w '%{http_code} %{time_total}' "$address")" || true
  code="${answer%% *}"
  seconds="${answer##* }"
  misses="$(cat "$STATE_DIR/watch/$name" 2>/dev/null || echo 0)"

  case "$code" in
    2??)
      [ "$misses" -ge "$MISSES_BEFORE_DOWN" ] && say "$name is back: $code"
      echo 0 > "$STATE_DIR/watch/$name"
      report "$name" ok "$code in ${seconds}s"
      return
      ;;
    000) why="no answer: the connection failed or took longer than $PATIENCE seconds" ;;
    530) why="530: Cloudflare can't reach the tunnel on the Pi" ;;
    502) why="502: the tunnel is up, but the site behind it doesn't answer" ;;
    *) why="the site answered $code" ;;
  esac
  misses=$((misses + 1))
  echo "$misses" > "$STATE_DIR/watch/$name"
  # Nothing is reported for a first miss. If it was the Pi's own connection, the next minute
  # shows it; if the reports stay away, healthchecks.io notices that by itself.
  [ "$misses" -ge "$MISSES_BEFORE_DOWN" ] || return 0
  [ "$misses" -eq "$MISSES_BEFORE_DOWN" ] && say "$name is DOWN: $why"
  report "$name" fail "$why"
}

for site in "${sites[@]}"; do
  check "$site" &
done
wait
