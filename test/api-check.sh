#!/usr/bin/env bash
# Checks the HTTP API as three people (art owns a list; mom and sis buy from it) and as visitors
# who aren't logged in. Needs a server with an empty database:
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
# upload <who> <path> <file>  → PUTs the file as the form field "image"
upload() { STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X PUT -b "$TMP/$1.jar" -F "image=@$3" "$BASE$2"); }
ok()   { echo "ok    $1"; }
bad()  { echo "FAIL  $1"; FAILED=1; }
check() { # check <description> <expected status>
  if [ "$STATUS" = "$2" ]; then ok "$1"; else bad "$1: expected $2, got $STATUS: $(head -c 300 "$BODY")"; fi
}
# The dev server pretty-prints JSON, so compare with all whitespace removed.
flat() { tr -d ' \n\t' < "$BODY"; }
# Fixed strings, not patterns: the expected JSON has brackets in it.
has()  { if flat | grep -qF -- "$(printf %s "$2" | tr -d ' ')"; then ok "$1"; else bad "$1: \"$2\" not in: $(flat | head -c 400)"; fi; }
lacks() { if flat | grep -qF -- "$(printf %s "$2" | tr -d ' ')"; then bad "$1: found \"$2\""; else ok "$1"; fi; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(eval("v"+process.argv[1]))})' "$1" < "$BODY"; }
# What an error answer says beyond the request's own address, its status and the dev server's stack.
said() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const {url,statusCode,stack,...rest}=JSON.parse(s);console.log(JSON.stringify(rest))})' < "$BODY"; }
jar_has() { grep -q -- "$2" "$TMP/$1.jar" 2>/dev/null; }

register() { req "$1" POST /api/auth/register "{\"email\":\"$1@example.test\",\"displayName\":\"$2\",\"password\":\"correct horse battery\"}"; }
login() { req "$1" POST /api/auth/login "{\"email\":\"$2@example.test\",\"password\":\"correct horse battery\"}"; }

# Well-formed, but no list has it.
UNKNOWN=AAAAAAAAAAAAAAAAAAAAAA
printf '\x89PNG\r\n\x1a\n0000000000000000' > "$TMP/pic.png"

echo "── accounts"
register art Art;  check "art registers without a username" 201; has "… and gets the display name back" '"displayName":"Art"'; lacks "… and no username" username
register mom Moeke; check "mom registers" 201
register sis Zus;  check "sis registers" 201
req anon POST /api/auth/register '{"email":"art@example.test","displayName":"X","password":"correct horse battery"}'
check "a second account with the same email is refused" 409; has "… with the code email_taken" email_taken
req anon POST /api/auth/register '{"email":"nope","displayName":"","password":"short"}'
check "a bad registration is refused" 422; has "… naming the fields" '"email":"invalid_email"'
req anon POST /api/auth/login '{"email":"art@example.test","password":"wrong wrong wrong"}'
check "a wrong password is refused" 401; has "… without saying which part was wrong" invalid_credentials
req anon GET /api/me; check "the account endpoint needs a login" 401
req art GET /api/me; check "art reads the account" 200; has "… with the email" '"email":"art@example.test"'; has "… and the display name" '"displayName":"Art"'
req art PATCH /api/me '{"displayName":"Arthur"}'; check "art changes the display name" 200; has "… and gets it back" '"displayName":"Arthur"'
req art PATCH /api/me '{"displayName":"Art"}'; check "… and changes it back" 200
req art GET /api/_auth/session; check "the page asks who is logged in" 200; has "… and it is art" '"displayName":"Art"'

echo "── lists"
req art POST /api/lists '{"title":"Verjaardag"}'; check "art makes a list" 201; TOKEN=$(json .token)
if [ "${#TOKEN}" = 22 ]; then ok "… its token has 22 characters"; else bad "the token is \"$TOKEN\""; fi
has "… and the title comes back" '"title":"Verjaardag"'
req mom POST /api/lists '{"title":"Moeke haar lijst"}'; check "mom makes a list of her own" 201; MOMLIST=$(json .token)
req art POST /api/lists '{"title":"   "}'; check "a list without a title is refused" 422
req anon POST /api/lists '{"title":"x"}'; check "making a list needs a login" 401
req art PATCH "/api/lists/$TOKEN" '{"title":"Verjaardag Art"}'; check "art renames the list" 200; has "… and gets the new title back" '"title":"Verjaardag Art"'
req mom PATCH "/api/lists/$TOKEN" '{"title":"Gekaapt"}'; check "mom cannot rename art's list" 404
req mom DELETE "/api/lists/$TOKEN"; check "mom cannot delete art's list" 404
req art GET /api/home; check "art opens the home page" 200; has "… and the list is there" "\"token\":\"$TOKEN\""

echo "── the owner builds a list"
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Slimme stekkers","description":"Zigbee","url":"https://example.test/plug","quantity":3}'; check "art adds a wish with amount 3" 201; PLUGS=$(json .id)
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Puzzels","quantity":null}'; check "art adds an unlimited wish" 201; PUZZLES=$(json .id)
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Sokken"}'; check "art adds a wish with only a title" 201; SOCKS=$(json .id); has "… and the amount is one" '"quantity":1'
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Boek"}'; check "art adds a wish nobody will buy" 201; BOOK=$(json .id)
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Kwaad","url":"javascript:alert(1)"}'; check "a javascript: link is refused" 422
req anon POST "/api/lists/$TOKEN/wishes" '{"title":"x"}'; check "adding a wish needs a login" 401
req mom POST "/api/lists/$TOKEN/wishes" '{"title":"Ondergeschoven"}'; check "mom cannot add to art's list" 404
req mom PATCH "/api/lists/$TOKEN/wishes/$PLUGS" '{"title":"Gekaapt"}'; check "mom cannot change art's wish" 404
req mom DELETE "/api/lists/$TOKEN/wishes/$PLUGS"; check "mom cannot delete art's wish" 404
req mom PATCH "/api/lists/$MOMLIST/wishes/$PLUGS" '{"title":"Gekaapt"}'; check "mom cannot change art's wish through her own list" 404
req mom DELETE "/api/lists/$MOMLIST/wishes/$PLUGS"; check "mom cannot delete art's wish through her own list" 404

echo "── a token that matches no list"
req anon GET "/api/lists/$UNKNOWN"; check "a visitor gets 404 for an unknown token" 404
req art GET "/api/lists/$UNKNOWN"; check "a logged-in person too" 404
req art GET "/api/lists/not-a-token"; check "a malformed token is 404 as well" 404
req art PATCH "/api/lists/$UNKNOWN" '{"title":"x"}'; check "renaming under an unknown token" 404
req art DELETE "/api/lists/$UNKNOWN"; check "deleting under an unknown token" 404
req art POST "/api/lists/$UNKNOWN/wishes" '{"title":"x"}'; check "adding a wish under an unknown token" 404
req art PATCH "/api/lists/$UNKNOWN/wishes/$PLUGS" '{"title":"x"}'; check "changing art's wish under an unknown token" 404
req art DELETE "/api/lists/$UNKNOWN/wishes/$PLUGS"; check "deleting art's wish under an unknown token" 404
upload art "/api/lists/$UNKNOWN/wishes/$PLUGS/image" "$TMP/pic.png"; check "an image under an unknown token" 404
req art DELETE "/api/lists/$UNKNOWN/wishes/$PLUGS/image"; check "removing an image under an unknown token" 404
req mom PUT "/api/lists/$UNKNOWN/wishes/$PLUGS/purchase" '{"quantity":1}'; check "buying under an unknown token" 404
req mom DELETE "/api/lists/$UNKNOWN/wishes/$PLUGS/purchase"; check "removing a purchase under an unknown token" 404
req mom POST "/api/lists/$UNKNOWN/wishes/$PLUGS/notes" '{"body":"x"}'; check "a note under an unknown token" 404

# What the owner and a visitor get before anyone bought anything. Compared again further down.
req art GET "/api/lists/$TOKEN"; cp "$BODY" "$TMP/owner-before"
req anon GET "/api/lists/$TOKEN"; cp "$BODY" "$TMP/anon-before"

echo "── buying"
req mom PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":2}'; check "mom buys 2 of 3" 204
req sis PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":2}'; check "sis cannot buy 2 more" 409; has "… because that exceeds the amount" quantity_exceeded
req sis PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":1}'; check "sis buys the last one" 204
req sis PUT "/api/lists/$TOKEN/wishes/$PUZZLES/purchase" '{"quantity":40}'; check "sis buys 40 of an unlimited wish" 204
req mom PUT "/api/lists/$TOKEN/wishes/$SOCKS/purchase" '{"quantity":1}'; check "mom buys the socks" 204
req mom PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":0}'; check "an amount of 0 is refused" 422
req anon PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":1}'; check "buying needs a login" 401
req mom PUT "/api/lists/$TOKEN/wishes/99999/purchase" '{"quantity":1}'; check "a wish that doesn't exist is not found" 404
req sis PUT "/api/lists/$MOMLIST/wishes/$BOOK/purchase" '{"quantity":1}'; check "sis cannot buy art's wish through mom's list" 404
req mom PUT "/api/lists/$MOMLIST/wishes/$BOOK/purchase" '{"quantity":1}'; check "mom cannot buy art's wish through her own list" 404
req mom GET "/api/lists/$TOKEN"; has "mom sees what was bought, added up" '"bought":3'

echo "── two buyers at the same moment"
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Laatste exemplaar","quantity":1}'; LAST=$(json .id)
for who in mom sis; do
  curl -s -o /dev/null -w '%{http_code}' -X PUT -b "$TMP/$who.jar" -H 'Content-Type: application/json' \
    --data '{"quantity":1}' "$BASE/api/lists/$TOKEN/wishes/$LAST/purchase" > "$TMP/race-$who" &
done
wait
RACE=$(printf '%s\n%s\n' "$(cat "$TMP/race-mom")" "$(cat "$TMP/race-sis")" | sort | tr '\n' ' ')
if [ "$RACE" = "204 409 " ]; then ok "exactly one of them gets the last one"; else bad "racing for the last one gave: $RACE"; fi
req mom DELETE "/api/lists/$TOKEN/wishes/$LAST/purchase"; req sis DELETE "/api/lists/$TOKEN/wishes/$LAST/purchase"
req art DELETE "/api/lists/$TOKEN/wishes/$LAST"
# Leave the list as it was for the comparison below: a deleted wish nobody holds is gone for everyone.

echo "── notes"
req mom POST "/api/lists/$TOKEN/wishes/$PLUGS/notes" '{"body":"Ik neem er twee, geheimpje."}'; check "mom leaves a note" 201; NOTE=$(json .id)
req anon POST "/api/lists/$TOKEN/wishes/$PLUGS/notes" '{"body":"x"}'; check "a note needs a login" 401
req mom POST "/api/lists/$MOMLIST/wishes/$PLUGS/notes" '{"body":"x"}'; check "mom cannot write on art's wish through her own list" 404
req art POST "/api/lists/$TOKEN/wishes/$PLUGS/notes" '{"body":"Wat kopen jullie?"}'; check "art cannot write a note on his own wish" 403
req art DELETE "/api/notes/$NOTE"; check "art gets 'not found' for mom's note" 404
req art DELETE "/api/notes/00000000-0000-0000-0000-000000000000"; check "… the same as for a note that doesn't exist" 404
req sis DELETE "/api/notes/$NOTE"; check "sis cannot delete mom's note" 404

echo "── what each viewer gets"
req mom GET "/api/lists/$TOKEN"; check "mom opens art's list" 200
has "mom is a buyer" '"role":"buyer"'; has "mom sees who bought" '"name":"Zus"'; has "mom sees the note" geheimpje
req anon GET "/api/lists/$TOKEN"; check "a visitor opens art's list" 200
has "the visitor is anonymous" '"role":"anon"'
for secret in purchases notes bought removed '"mine"' Moeke Zus geheimpje; do lacks "the visitor's response has no '$secret'" "$secret"; done
req art GET "/api/lists/$TOKEN"; check "art opens his own list" 200
has "art is the owner" '"role":"owner"'
for secret in purchases notes bought removed Moeke Zus geheimpje; do lacks "art's response has no '$secret'" "$secret"; done
if cmp -s "$BODY" "$TMP/owner-before"; then ok "art's list is byte for byte what it was before anyone bought"; else bad "art's list changed after buyers acted"; fi
req anon GET "/api/lists/$TOKEN"
if cmp -s "$BODY" "$TMP/anon-before"; then ok "the visitor's list is byte for byte what it was before anyone bought"; else bad "the visitor's list changed after buyers acted"; fi
curl -s -D "$TMP/headers" -o /dev/null -b "$TMP/art.jar" "$BASE/api/lists/$TOKEN"
if grep -qi 'cache-control: private, no-store' "$TMP/headers"; then ok "the list is never cached"; else bad "cache-control missing"; fi

echo "── the page Nuxt renders for each viewer"
# The page carries the API's answer in its HTML. Fetched as a page, it may hold no more than the API gave.
page() { STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -b "$TMP/$1.jar" -c "$TMP/$1.jar" "$BASE/l/$TOKEN"); }
page art; check "art opens the page of his list" 200
for secret in Moeke Zus geheimpje; do lacks "… and the HTML has no '$secret'" "$secret"; done
page page-visitor; check "a visitor opens the page" 200
for secret in Moeke Zus geheimpje; do lacks "… and the HTML has no '$secret'" "$secret"; done
page sis; check "sis opens the page" 200
has "… and the HTML names mom, who bought" Moeke; has "… and holds mom's note" geheimpje

echo "── the owner ticks his own wishes"
req art PUT "/api/lists/$TOKEN/wishes/$BOOK/purchase" '{"quantity":1}'; check "art ticks his own free wish" 204
req art GET "/api/lists/$TOKEN"; has "… and his list shows it as his" '"mine":1'
for secret in purchases notes bought removed Moeke Zus geheimpje; do lacks "… and still has no '$secret'" "$secret"; done
req art PUT "/api/lists/$TOKEN/wishes/$SOCKS/purchase" '{"quantity":1}'; check "art ticks the socks mom already has" 409; has "… with the code quantity_exceeded" quantity_exceeded
REFUSAL=$(said)
if printf %s "$REFUSAL" | grep -q 'Moeke'; then bad "the refusal names mom: $REFUSAL"; else ok "… the refusal names nobody"; fi
if printf %s "$REFUSAL" | grep -q '[0-9]'; then bad "the refusal holds a number: $REFUSAL"; else ok "… and holds no number"; fi

echo "── the owner changes things buyers already acted on"
req art PATCH "/api/lists/$TOKEN/wishes/$PLUGS" '{"quantity":2}'; check "art lowers the amount below what is bought, sending only the amount" 200; has "… and gets the wish back" '"quantity":2'
has "… with its text kept" '"description":"Zigbee"'; has "… and its link" '"url":"https://example.test/plug"'
req art PATCH "/api/lists/$TOKEN/wishes/$PLUGS" '{}'; check "a change that names no field is refused" 422
req art DELETE "/api/lists/$TOKEN/wishes/$SOCKS"; check "art deletes the bought wish" 204
req art DELETE "/api/lists/$TOKEN/wishes/$SOCKS"; check "a second delete finds nothing" 404
req art DELETE "/api/lists/$TOKEN/wishes/$PUZZLES"; check "art deletes another bought wish, same answer" 204
req art GET "/api/lists/$TOKEN"; lacks "art no longer sees the socks" Sokken
req sis GET "/api/lists/$TOKEN"; has "sis still sees the socks" Sokken; has "… marked as removed" '"removed":true'
req sis PUT "/api/lists/$TOKEN/wishes/$SOCKS/purchase" '{"quantity":1}'; check "sis cannot newly buy a removed wish" 409; has "… with the code wish_removed" wish_removed
req sis PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":2}'; check "sis cannot raise on the lowered wish" 409
req mom PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":1}'; check "mom can lower on the lowered wish" 204

echo "── images"
printf 'just text' > "$TMP/fake.png"
upload art "/api/lists/$TOKEN/wishes/$PLUGS/image" "$TMP/pic.png"; check "art uploads an image" 200; IMAGE=$(json .image)
upload art "/api/lists/$TOKEN/wishes/$PLUGS/image" "$TMP/fake.png"; check "a text file named .png is refused" 422
upload mom "/api/lists/$TOKEN/wishes/$PLUGS/image" "$TMP/pic.png"; check "mom cannot set the image of art's wish" 404
upload mom "/api/lists/$MOMLIST/wishes/$PLUGS/image" "$TMP/pic.png"; check "… nor through her own list" 404
head -c 4000000 /dev/zero > "$TMP/big.png"
upload art "/api/lists/$TOKEN/wishes/$PLUGS/image" "$TMP/big.png"; check "a 4 MB upload is refused" 413
curl -s -D "$TMP/headers" -o /dev/null "$BASE$IMAGE"
if grep -qi 'immutable' "$TMP/headers" && grep -qi 'content-type: image/png' "$TMP/headers"; then ok "the image is served as image/png, cacheable forever"; else bad "image headers: $(cat "$TMP/headers")"; fi
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' --path-as-is "$BASE/uploads/..%2f..%2fwishlist.db"); check "a path outside the uploads folder is not found" 404
req mom DELETE "/api/lists/$TOKEN/wishes/$PLUGS/image"; check "mom cannot remove the image of art's wish" 404
req art DELETE "/api/lists/$TOKEN/wishes/$PLUGS/image"; check "art removes the image" 204
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' "$BASE$IMAGE"); check "the removed image is gone" 404

echo "── remembering opened lists"
req mom GET /api/home; has "mom's home page has art's list among the opened ones" "\"opened\":[{\"token\":\"$TOKEN\""
req art GET /api/home; has "art's own list is not among his opened ones" '"opened":[]'
req guest GET "/api/lists/$TOKEN"; check "a visitor who isn't logged in opens the list" 200
if jar_has guest opened-lists && jar_has guest "$TOKEN"; then ok "… and gets the opened-lists cookie with its token"; else bad "no opened-lists cookie with the token: $(cat "$TMP/guest.jar")"; fi
req guest GET /api/home; check "the visitor opens the home page" 200; has "… owning nothing" '"owned":[]'; has "… with the list among the opened ones" "\"token\":\"$TOKEN\""
register guest Oma; check "the visitor makes an account" 201
if jar_has guest opened-lists; then bad "the cookie is still there after registering"; else ok "… and the cookie is cleared"; fi
req guest GET /api/home; has "… and the list is in the account" "\"opened\":[{\"token\":\"$TOKEN\""
register opa-account Opa
req opa GET "/api/lists/$TOKEN"; check "another visitor opens the list" 200
login opa opa-account; check "… then logs in" 200; has "… and gets the display name back" '"displayName":"Opa"'
if jar_has opa opened-lists; then bad "the cookie is still there after logging in"; else ok "… and the cookie is cleared"; fi
req opa GET /api/home; has "… and the list is in the account" "\"opened\":[{\"token\":\"$TOKEN\""
req opa DELETE "/api/home/opened/$TOKEN"; check "opa removes it from his home page" 204
req opa GET /api/home; lacks "… and it is gone" "$TOKEN"
req stranger GET "/api/lists/$TOKEN"
req stranger DELETE "/api/home/opened/$TOKEN"; check "a visitor who isn't logged in removes it too" 204
req stranger GET /api/home; lacks "… and it is gone from the home page" "$TOKEN"
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -b "opened-lists=junk.%%%.$UNKNOWN..$TOKEN.$(head -c 300 /dev/zero | tr '\0' 'x')" "$BASE/api/home")
check "a cookie with junk in it still gives a home page" 200
has "… with the list it could find" "\"token\":\"$TOKEN\""; lacks "… and not the token that matches nothing" "$UNKNOWN"

echo "── deleting a list"
req art DELETE "/api/lists/$TOKEN"; check "art deletes his list" 204
req art DELETE "/api/lists/$TOKEN"; check "a second delete finds nothing" 404
req art GET "/api/lists/$TOKEN"; check "art no longer gets it" 404
req anon GET "/api/lists/$TOKEN"; check "a visitor no longer gets it" 404
req mom GET "/api/lists/$TOKEN"; check "mom, who bought from it, still gets it" 200; has "… marked as deleted" '"deleted":true'
req mom PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":2}'; check "mom cannot buy more on it" 409; has "… because it was removed" wish_removed
req mom DELETE "/api/lists/$TOKEN/wishes/$PLUGS/purchase"; check "mom can still take back her purchase" 204
req art GET /api/home; lacks "art's home page no longer has it" "$TOKEN"

echo "── guard rails"
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X POST -b "$TMP/mom.jar" -H 'Origin: https://evil.example' -H 'Content-Type: application/json' --data '{"title":"x"}' "$BASE/api/lists"); check "a request from another site is refused" 403
head -c 20000 /dev/zero | tr '\0' 'a' > "$TMP/long"
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X POST -b "$TMP/mom.jar" -H 'Content-Type: application/json' --data "{\"title\":\"$(cat "$TMP/long")\"}" "$BASE/api/lists"); check "a 20 KB body is refused" 413
for i in 1 2 3 4 5; do req anon POST /api/auth/login '{"email":"sis@example.test","password":"wrong wrong wrong"}'; done
login anon sis; check "after five wrong passwords the account is locked for a while" 429
login anon2 mom; check "another account can still log in" 200

rm -rf "$TMP"
if [ "$FAILED" = 0 ]; then echo; echo "All checks passed."; else echo; echo "Some checks FAILED."; fi
exit $FAILED
