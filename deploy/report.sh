# Sourced by watch.sh, backup.sh and deploy.sh: tells healthchecks.io how something went, so
# it can warn whoever runs the site when a site, a backup or a deploy fails.
#
#   report <check> ok|fail|start [what happened]
#
# Without HC_PING_KEY in ~/.config/pakske-watch.env it does nothing. It never stops the script
# that calls it: a report that can't be sent is dropped.

WATCH_ENV_FILE="${WATCH_ENV_FILE:-$HOME/.config/pakske-watch.env}"

# Each line is NAME=value and the value is taken as written: no quotes, and nothing in it is run.
if [ -r "$WATCH_ENV_FILE" ]; then
  while IFS= read -r report_line; do
    case "$report_line" in
      HC_*=* | WATCH_*=*) export "${report_line%%=*}=${report_line#*=}" ;;
    esac
  done < "$WATCH_ENV_FILE"
fi

report() {
  [ -n "${HC_PING_KEY:-}" ] || return 0
  local end=""
  case "$2" in
    fail) end=/fail ;;
    start) end=/start ;;
  esac
  # create=1: a check that doesn't exist yet is made, so a report is never lost. `watch.sh setup`
  # gives it its schedule.
  curl -fsS -m 10 --retry 2 -o /dev/null --data-raw "${3:-}" \
    "${HC_PING_URL:-https://hc-ping.com}/$HC_PING_KEY/$1$end?create=1" 2>/dev/null || true
}
