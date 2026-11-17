#!/usr/bin/env bash
# Checks the HTTP API as three people (art owns the list; mom and sis buy) and as a visitor
# who isn't logged in. Needs a server with an empty database:
#
#   NUXT_DATA_DIR=$(mktemp -d) pnpm dev --port 3112   # in one terminal (stop any other `pnpm dev` first)
#   test/api-check.sh http://localhost:3112           # in another
#
# Prints one line per check and exits 1 if any failed.
set -u
BASE=${1:-http://localhost:3112}
TMP=$(mktemp -d)
FAILED=0
BODY="$TMP/body"
curl -s -o /dev/null "$BASE/api/health" || { echo "No server at $BASE. See the top of this file."; exit 1; }

# req <who> <method> <path> [json]  → sets STATUS, leaves the response in $BODY
req() {
  local who=$1 method=$2 path=$3 data=${4-}
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$method" -b "$TMP/$who.jar" -c "$TMP/$who.jar")
  if [ -n "$data" ]; then args+=(-H 'Content-Type: application/json' --data "$data"); fi
  if [ -z "$data" ] && [ "$method" != GET ] && [ "$method" != DELETE ]; then args+=(-H 'Content-Length: 0'); fi
  STATUS=$(curl "${args[@]}" "$BASE$path")
}
check() { # check <description> <expected status>
  if [ "$STATUS" = "$2" ]; then echo "ok    $1"; else echo "FAIL  $1: expected $2, got $STATUS: $(head -c 300 "$BODY")"; FAILED=1; fi
}
# The dev server pretty-prints JSON, so compare with all whitespace removed.
flat() { tr -d ' \n\t' < "$BODY"; }
has()  { if flat | grep -q -- "$(printf %s "$2" | tr -d ' ')"; then echo "ok    $1"; else echo "FAIL  $1: \"$2\" not in: $(flat | head -c 400)"; FAILED=1; fi; }
lacks() { if flat | grep -q -- "$(printf %s "$2" | tr -d ' ')"; then echo "FAIL  $1: found \"$2\""; FAILED=1; else echo "ok    $1"; fi; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(eval("v"+process.argv[1]))})' "$1" < "$BODY"; }

register() { req "$1" POST /api/auth/register "{\"email\":\"$1@example.test\",\"username\":\"$1\",\"displayName\":\"$2\",\"password\":\"correct horse battery\"}"; }

echo "── accounts"
register art Art;  check "art registers" 201
register mom Moeke; check "mom registers" 201
register sis Zus;  check "sis registers" 201
req anon POST /api/auth/register '{"email":"art@example.test","username":"art2","displayName":"X","password":"correct horse battery"}'
check "a second account with the same email is refused" 409; has "… with the code email_taken" email_taken
req anon POST /api/auth/register '{"email":"nope","username":"A!","displayName":"","password":"short"}'
check "a bad registration is refused" 422; has "… naming the fields" '"username":"invalid_username"'
req anon POST /api/auth/login '{"email":"art@example.test","password":"wrong wrong wrong"}'
check "a wrong password is refused" 401; has "… without saying which part was wrong" invalid_credentials
req anon GET /api/me; check "the account endpoint needs a login" 401

echo "── the owner builds a list"
req art POST /api/me/items '{"title":"Slimme stekkers","description":"Zigbee","url":"https://example.test/plug","quantity":3}'; check "art adds a wish with amount 3" 201; PLUGS=$(json .id)
req art POST /api/me/items '{"title":"Puzzels","description":"","url":"","quantity":null}'; check "art adds an unlimited wish" 201; PUZZLES=$(json .id)
req art POST /api/me/items '{"title":"Sokken","description":"","url":"","quantity":1}'; check "art adds a third wish" 201; SOCKS=$(json .id)
req art POST /api/me/items '{"title":"Kwaad","url":"javascript:alert(1)","quantity":1}'; check "a javascript: link is refused" 422
req anon POST /api/me/items '{"title":"x","quantity":1}'; check "adding a wish needs a login" 401
req mom PATCH "/api/me/items/$PLUGS" '{"title":"Gekaapt","quantity":1}'; check "mom cannot change art's wish" 404
req mom DELETE "/api/me/items/$PLUGS"; check "mom cannot delete art's wish" 404

# What the owner and a visitor get before anyone bought anything. Compared again further down.
req art GET /api/lists/art; cp "$BODY" "$TMP/owner-before"
req anon GET /api/lists/art; cp "$BODY" "$TMP/anon-before"

echo "── buying"
req mom PUT "/api/items/$PLUGS/purchase" '{"quantity":2}'; check "mom buys 2 of 3" 204
req sis PUT "/api/items/$PLUGS/purchase" '{"quantity":2}'; check "sis cannot buy 2 more" 409; has "… because that exceeds the amount" quantity_exceeded
req sis PUT "/api/items/$PLUGS/purchase" '{"quantity":1}'; check "sis buys the last one" 204
req sis PUT "/api/items/$PUZZLES/purchase" '{"quantity":40}'; check "sis buys 40 of an unlimited wish" 204
req mom PUT "/api/items/$SOCKS/purchase" '{"quantity":1}'; check "mom buys the socks" 204
req mom PUT "/api/items/$PLUGS/purchase" '{"quantity":0}'; check "an amount of 0 is refused" 422
req anon PUT "/api/items/$PLUGS/purchase" '{"quantity":1}'; check "buying needs a login" 401
req art PUT "/api/items/$PLUGS/purchase" '{"quantity":1}'; check "art cannot buy on the own list" 403
req art DELETE "/api/items/$PLUGS/purchase"; check "art cannot remove a purchase on the own list" 403
req art PUT "/api/items/$PUZZLES/purchase" '{"quantity":1}'; check "… same answer on a wish with other buyers" 403
req mom PUT "/api/items/99999/purchase" '{"quantity":1}'; check "a wish that doesn't exist is not found" 404

echo "── two buyers at the same moment"
req art POST /api/me/items '{"title":"Laatste exemplaar","description":"","url":"","quantity":1}'; LAST=$(json .id)
for who in mom sis; do
  curl -s -o /dev/null -w '%{http_code}' -X PUT -b "$TMP/$who.jar" -H 'Content-Type: application/json' \
    --data '{"quantity":1}' "$BASE/api/items/$LAST/purchase" > "$TMP/race-$who" &
done
wait
RACE=$(printf '%s\n%s\n' "$(cat "$TMP/race-mom")" "$(cat "$TMP/race-sis")" | sort | tr '\n' ' ')
if [ "$RACE" = "204 409 " ]; then echo "ok    exactly one of them gets the last one"; else echo "FAIL  racing for the last one gave: $RACE"; FAILED=1; fi
req mom DELETE "/api/items/$LAST/purchase"; req sis DELETE "/api/items/$LAST/purchase"
req art DELETE "/api/me/items/$LAST"
# Leave the list as it was for the comparison below: a deleted wish nobody holds is gone for everyone.

echo "── notes"
req mom POST "/api/items/$PLUGS/notes" '{"body":"Ik neem er twee, geheimpje."}'; check "mom leaves a note" 201; NOTE=$(json .id)
req art POST "/api/items/$PLUGS/notes" '{"body":"Wat kopen jullie?"}'; check "art cannot write a note on the own list" 403
req art DELETE "/api/notes/$NOTE"; check "art gets 'not found' for mom's note" 404
req art DELETE "/api/notes/00000000-0000-0000-0000-000000000000"; check "… the same as for a note that doesn't exist" 404
req sis DELETE "/api/notes/$NOTE"; check "sis cannot delete mom's note" 404

echo "── what each viewer gets"
req mom GET /api/lists/art; check "mom opens art's list" 200
has "mom is a buyer" '"viewer":"buyer"'; has "mom sees who bought" '"name":"Zus"'; has "mom sees the note" geheimpje
req anon GET /api/lists/art; check "a visitor opens art's list" 200
has "the visitor is anonymous" '"viewer":"anon"'
for secret in purchases notes bought removed Moeke Zus geheimpje; do lacks "the visitor's response has no '$secret'" "$secret"; done
req art GET /api/lists/art; check "art opens the own list" 200
has "art is the owner" '"viewer":"owner"'
for secret in purchases notes bought removed Moeke Zus geheimpje; do lacks "art's response has no '$secret'" "$secret"; done
if cmp -s "$BODY" "$TMP/owner-before"; then echo "ok    art's list is byte for byte what it was before anyone bought"; else echo "FAIL  art's list changed after buyers acted"; FAILED=1; fi
req anon GET /api/lists/art
if cmp -s "$BODY" "$TMP/anon-before"; then echo "ok    the visitor's list is byte for byte what it was before anyone bought"; else echo "FAIL  the visitor's list changed after buyers acted"; FAILED=1; fi
curl -s -D "$TMP/headers" -o /dev/null -b "$TMP/art.jar" "$BASE/api/lists/art"
if grep -qi 'cache-control: private, no-store' "$TMP/headers"; then echo "ok    the list is never cached"; else echo "FAIL  cache-control missing"; FAILED=1; fi

echo "── the owner changes things buyers already acted on"
req art PATCH "/api/me/items/$PLUGS" '{"title":"Slimme stekkers","description":"Zigbee","url":"https://example.test/plug","quantity":2}'; check "art lowers the amount below what is bought" 200
req art DELETE "/api/me/items/$SOCKS"; check "art deletes the bought wish" 204
req art DELETE "/api/me/items/$SOCKS"; check "a second delete finds nothing" 404
req art DELETE "/api/me/items/$PUZZLES"; check "art deletes another bought wish, same answer" 204
req art GET /api/lists/art; lacks "art no longer sees the socks" Sokken
req sis GET /api/lists/art; has "sis still sees the socks" Sokken; has "… marked as removed" '"removed":true'
req sis PUT "/api/items/$SOCKS/purchase" '{"quantity":1}'; check "sis cannot newly buy a removed wish" 409; has "… with the code item_removed" item_removed
req sis PUT "/api/items/$PLUGS/purchase" '{"quantity":2}'; check "sis cannot raise on the lowered wish" 409
req mom PUT "/api/items/$PLUGS/purchase" '{"quantity":1}'; check "mom can lower on the lowered wish" 204

echo "── images"
printf '\x89PNG\r\n\x1a\n0000000000000000' > "$TMP/pic.png"
printf 'just text' > "$TMP/fake.png"
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X PUT -b "$TMP/art.jar" -F "image=@$TMP/pic.png" "$BASE/api/me/items/$PLUGS/image"); check "art uploads an image" 200; IMAGE=$(json .image)
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X PUT -b "$TMP/art.jar" -F "image=@$TMP/fake.png" "$BASE/api/me/items/$PLUGS/image"); check "a text file named .png is refused" 422
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X PUT -b "$TMP/mom.jar" -F "image=@$TMP/pic.png" "$BASE/api/me/items/$PLUGS/image"); check "mom cannot set the image of art's wish" 404
head -c 4000000 /dev/zero > "$TMP/big.png"
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X PUT -b "$TMP/art.jar" -F "image=@$TMP/big.png" "$BASE/api/me/items/$PLUGS/image"); check "a 4 MB upload is refused" 413
curl -s -D "$TMP/headers" -o /dev/null "$BASE$IMAGE"
if grep -qi 'immutable' "$TMP/headers" && grep -qi 'content-type: image/png' "$TMP/headers"; then echo "ok    the image is served as image/png, cacheable forever"; else echo "FAIL  image headers: $(cat "$TMP/headers")"; FAILED=1; fi
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' --path-as-is "$BASE/uploads/..%2f..%2fwishlist.db"); check "a path outside the uploads folder is not found" 404
req art DELETE "/api/me/items/$PLUGS/image"; check "art removes the image" 204
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' "$BASE$IMAGE"); check "the removed image is gone" 404

echo "── guard rails"
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X POST -b "$TMP/mom.jar" -H 'Origin: https://evil.example' -H 'Content-Type: application/json' --data '{"body":"x"}' "$BASE/api/items/$PLUGS/notes"); check "a request from another site is refused" 403
head -c 20000 /dev/zero | tr '\0' 'a' > "$TMP/long"
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X POST -b "$TMP/mom.jar" -H 'Content-Type: application/json' --data "{\"body\":\"$(cat "$TMP/long")\"}" "$BASE/api/items/$PLUGS/notes"); check "a 20 KB note is refused" 413
for i in 1 2 3 4 5; do req anon POST /api/auth/login '{"email":"sis@example.test","password":"wrong wrong wrong"}'; done
req anon POST /api/auth/login '{"email":"sis@example.test","password":"correct horse battery"}'; check "after five wrong passwords the account is locked for a while" 429
req anon2 POST /api/auth/login '{"email":"mom@example.test","password":"correct horse battery"}'; check "another account can still log in" 200

rm -rf "$TMP"
if [ "$FAILED" = 0 ]; then echo; echo "All checks passed."; else echo; echo "Some checks FAILED."; fi
exit $FAILED
