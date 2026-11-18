#!/usr/bin/env bash
# Auto-deploy for the Raspberry Pi. A systemd timer runs this every minute.
# It asks GitHub whether main has moved. If not, it stops there. If it has, it pulls, builds,
# and switches the site over to the new build once that build answers. GitHub never has to
# reach the Pi.
#
#   deploy/deploy.sh           deploy if there is something new
#   deploy/deploy.sh --force   build and switch over even if nothing changed, or if this
#                              commit failed before
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
# the branch that goes live; another one only to try a deploy out
BRANCH="${BRANCH:-main}"
KEEP_RELEASES=3
FORCE="${1:-}"

mkdir -p "$STATE_DIR/releases" "$STATE_DIR/node"
cd "$APP_DIR"

# one deploy at a time: a build takes longer than the minute between checks
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || exit 0

git fetch --quiet origin "$BRANCH"
target="$(git rev-parse "origin/$BRANCH")"
live="$(basename "$(readlink "$STATE_DIR/current" 2>/dev/null || echo none)")"
if [ "$FORCE" != "--force" ]; then
  [ "$live" = "$target" ] && exit 0
  # a commit that failed once fails again: wait for the next commit instead of rebuilding every minute
  [ "$(cat "$STATE_DIR/failed" 2>/dev/null)" = "$target" ] && exit 0
fi

echo "$(date '+%F %T') Deploying ${target:0:7}: $(git log -1 --format=%s "$target")"
fail() {
  echo "$(date '+%F %T') FAILED ${target:0:7}: $1. The live site stays on ${live:0:7}."
  echo "$target" > "$STATE_DIR/failed"
  exit 1
}

# only ever fast-forward: if someone edited files on the Pi, stop and say so instead of overwriting
git merge --quiet --ff-only "origin/$BRANCH" || fail "the checkout on the Pi has its own changes"

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
rm -rf "$release"
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
    echo "$(date '+%F %T') Deployed ${target:0:7}"
    exit 0
  fi
  sleep 2
done

if [ -d "$STATE_DIR/releases/$live" ]; then
  switch_to "$STATE_DIR/releases/$live"
fi
fail "the new build did not answer on /api/health within a minute"
