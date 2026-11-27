#!/usr/bin/env bash
# Auto-deploy for the Raspberry Pi. A systemd timer runs this every minute.
# It asks GitHub for the newest release: the highest tag named vMAJOR.MINOR.PATCH, which
# deploy/release.sh makes. If that one is live, it stops there. If not, it builds that release
# and switches the site over once the new build answers. GitHub never has to reach the Pi.
# A tag with more after the version (v1.2.0-rc.1) is never deployed, and neither is main.
#
#   deploy/deploy.sh                         deploy the newest release if it isn't live
#   deploy/deploy.sh --force                 build and switch over even if nothing changed,
#                                            or if this release failed before
#   RELEASE=v1.2.0 deploy/deploy.sh --force  deploy that release by hand; the timer goes back
#                                            to the newest a minute later
#
# Deleting a release's tag on GitHub takes it back: the newest release left goes live.
#
# Each build becomes a release folder; `current` points at the live one. The site keeps running
# from the old release while the new one builds, so a deploy never serves half a build, and a
# build that fails or doesn't answer leaves the old release live.
#
# The database and uploads live in NUXT_DATA_DIR from ~/.config/pakske.env, outside both the
# checkout and the releases, so a deploy never touches them.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/pakske}"
ENV_FILE="${ENV_FILE:-$HOME/.config/pakske.env}"
STATE_DIR="${STATE_DIR:-$HOME/.local/share/pakske}"
# a release to deploy by hand instead of the newest one
RELEASE="${RELEASE:-}"
KEEP_RELEASES=3
FORCE="${1:-}"

mkdir -p "$STATE_DIR/releases" "$STATE_DIR/node"
cd "$APP_DIR"

# one deploy at a time: a build takes longer than the minute between checks
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || exit 0

# --force: a tag that was moved on GitHub moves here too; --prune-tags: a deleted one goes
git fetch --quiet --force --prune --prune-tags --tags origin
tag="${RELEASE:-$(git tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true)}"
# nothing released yet: the site stays as it is
[ -n "$tag" ] || exit 0
target="$(git rev-parse --verify "$tag^{commit}")"
live="$(basename "$(readlink "$STATE_DIR/current" 2>/dev/null || echo none)")"
if [ "$FORCE" != "--force" ]; then
  # a release folder is named after its commit, with a suffix when --force rebuilt that commit
  [ "${live%%-*}" = "$target" ] && exit 0
  # a release that failed once fails again: wait for the next one instead of rebuilding every minute
  [ "$(cat "$STATE_DIR/failed" 2>/dev/null)" = "$target" ] && exit 0
fi

# pakske-deploy.service writes every build's output to deploy.log. Past a megabyte the oldest
# half goes, cut at the start of a line. The file is emptied and refilled, not replaced, so the
# service goes on writing to the same file.
log="$STATE_DIR/deploy.log"
if [ "$(stat -c %s "$log" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  tail -c 524288 "$log" | tail -n +2 > "$log.keep" && cat "$log.keep" > "$log"
  rm -f "$log.keep"
fi

# healthchecks.io hears how each deploy went, when ~/.config/pakske-watch.env has its key.
# shellcheck source=deploy/report.sh
. deploy/report.sh

subject="$(git log -1 --format=%s "$target")"
echo "$(date '+%F %T') Deploying $tag (${target:0:7}): $subject"
fail() {
  echo "$(date '+%F %T') FAILED $tag (${target:0:7}): $1. The live site stays on ${live:0:7}."
  echo "$target" > "$STATE_DIR/failed"
  report pakske-deploy fail "$tag (${target:0:7}, $subject): $1. The live site stays on ${live:0:7}."
  exit 1
}

# build exactly that release; if someone edited files on the Pi, stop and say so instead of overwriting
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "the checkout on the Pi has its own changes"
git checkout --quiet --detach "$target"

# Pakske needs a newer Node than the Pi's own, which the other sites use. It gets its own copy,
# at the version deploy/node-version names, checked against the checksum written there too.
read -r node_version node_sha < deploy/node-version
node_home="$STATE_DIR/node/v$node_version"
if [ ! -x "$node_home/bin/node" ]; then
  echo "Installing Node $node_version"
  tarball="node-v$node_version-linux-arm64.tar.xz"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/v$node_version/$tarball" || fail "could not download Node $node_version"
  echo "$node_sha  $tmp/$tarball" | sha256sum -c --quiet || fail "Node $node_version did not match its checksum"
  mkdir -p "$node_home"
  tar -xJf "$tmp/$tarball" -C "$node_home" --strip-components=1
  rm -rf "$tmp"
fi
ln -sfn "$node_home" "$STATE_DIR/node/current"

# pm2 itself keeps running on the Pi's own Node; only the build and the site use Pakske's
system_path="$PATH"
export PATH="$node_home/bin:$PATH"

# pnpm at the version package.json asks for, installed into Pakske's Node (Node 25+ has no corepack)
pnpm_version="$(node -p "require('./package.json').packageManager.split('@')[1]")"
if [ "$(pnpm --version 2>/dev/null)" != "$pnpm_version" ]; then
  npm install --global --silent "pnpm@$pnpm_version"
fi

pnpm install --frozen-lockfile || fail "pnpm install failed"
pnpm build || fail "the build failed"

# What the server reads from disk besides .output: the migrations, which run when it starts,
# and the scripts. The same files the Dockerfile copies.
release="$STATE_DIR/releases/$target"
# never write into the release the site is running from
[ -e "$release" ] && release="$release-$(date +%s)"
mkdir -p "$release/server/db"
cp -a .output "$release/.output"
cp -a server/db/migrations "$release/server/db/migrations"
cp -a scripts "$release/scripts"

switch_to() {
  ln -sfn "$1" "$STATE_DIR/current.new"
  mv -Tf "$STATE_DIR/current.new" "$STATE_DIR/current"
  PATH="$system_path" pm2 startOrReload deploy/ecosystem.config.cjs --update-env >/dev/null
}
switch_to "$release"

# the site counts as deployed once it answers; otherwise the previous release goes back live
port="$(sed -n 's/^PORT=//p' "$ENV_FILE")"
for _ in $(seq 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${port:-3030}/api/health"; then
    PATH="$system_path" pm2 save >/dev/null
    rm -f "$STATE_DIR/failed"
    # the newest few releases stay, to go back to by hand: see docs/deploying.md
    ls -1t "$STATE_DIR/releases" | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
      rm -rf "${STATE_DIR:?}/releases/$old"
    done
    echo "$(date '+%F %T') Deployed $tag (${target:0:7})"
    report pakske-deploy ok "Deployed $tag (${target:0:7}): $subject"
    exit 0
  fi
  sleep 2
done

if [ -d "$STATE_DIR/releases/$live" ]; then
  switch_to "$STATE_DIR/releases/$live"
fi
fail "the new build did not answer on /api/health within a minute"
