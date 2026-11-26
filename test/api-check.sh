#!/usr/bin/env bash
# Checks the HTTP API as four people (art owns a list; mom and sis buy from it; lot shares wishes
# and a list with art; the four draw names in a Secret Santa) and as visitors who aren't logged
# in. Needs a server with an empty database:
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
# lines <file>: the JSON one field per line, so `diff` shows what changed whichever server sent it.
# The production server sends JSON on one line.
lines() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))' < "$1"; }
# What an error answer says beyond the request's own address, its status and the dev server's stack.
said() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const {url,statusCode,stack,...rest}=JSON.parse(s);console.log(JSON.stringify(rest))})' < "$BODY"; }
jar_has() { grep -q -- "$2" "$TMP/$1.jar" 2>/dev/null; }
same() { # same <description> <json expression> <expected>
  local got; got=$(json "$2" 2>/dev/null)
  if [ "$got" = "$3" ]; then ok "$1"; else bad "$1: expected $3, got \"$got\""; fi
}
# status_of <path>: the status of a plain GET, for files
status_of() { STATUS=$(curl -s -o "$BODY" -w '%{http_code}' "$BASE$1"); }
# preview <path>: the page a chat app gets when someone sends that link: no login, and on to
# wherever the site sends it.
preview() { STATUS=$(curl -s -L -o "$BODY" -w '%{http_code}' -A WhatsApp "$BASE$1"); }

register() { req "$1" POST /api/auth/register "{\"email\":\"$1@example.test\",\"displayName\":\"$2\",\"password\":\"correct horse battery\"}"; }
login() { req "$1" POST /api/auth/login "{\"email\":\"$2@example.test\",\"password\":\"correct horse battery\"}"; }

# Well-formed, but no list has it.
UNKNOWN=AAAAAAAAAAAAAAAAAAAAAA
printf '\x89PNG\r\n\x1a\n0000000000000000' > "$TMP/pic.png"

echo "── accounts"
register art Art;  check "art registers without a username" 201; has "… and gets the display name back" '"displayName":"Art"'; lacks "… and no username" username
register mom Moeke; check "mom registers" 201
register sis Zus;  check "sis registers" 201
register lot Lotte; check "lot registers" 201
req anon POST /api/auth/register '{"email":"art@example.test","displayName":"X","password":"correct horse battery"}'
check "a second account with the same email is refused" 409; has "… with the code email_taken" email_taken
req anon POST /api/auth/register '{"email":"nope","displayName":"","password":"short"}'
check "a bad registration is refused" 422; has "… naming the fields" '"email":"invalid_email"'
req anon POST /api/auth/register '{"email":"short@example.test","displayName":"Kort","password":"1234567"}'
check "a password of 7 characters is refused" 422; has "… as too short" '"password":"password_short"'
req short POST /api/auth/register '{"email":"short@example.test","displayName":"Kort","password":"12345678"}'
check "… and one of 8 is enough" 201
req anon POST /api/auth/login '{"email":"art@example.test","password":"wrong wrong wrong"}'
check "a wrong password is refused" 401; has "… without saying which part was wrong" invalid_credentials
req anon GET /api/me; check "the account endpoint needs a login" 401
req art GET /api/me; check "art reads the account" 200; has "… with the email" '"email":"art@example.test"'; has "… and the display name" '"displayName":"Art"'
req art PATCH /api/me '{"displayName":"Arthur"}'; check "art changes the display name" 200; has "… and gets it back" '"displayName":"Arthur"'
req art PATCH /api/me '{"displayName":"Art"}'; check "… and changes it back" 200
req art GET /api/_auth/session; check "the page asks who is logged in" 200; has "… and it is art" '"displayName":"Art"'
req art GET /api/me/lists; has "art starts with one list, named in Dutch" '"title":"Verlanglijst"'
req eng POST /api/auth/register '{"email":"eng@example.test","displayName":"Eng","password":"correct horse battery","locale":"en"}'; check "someone registers on the English page" 201
req eng GET /api/me/lists; has "… and starts with a list named in English" '"title":"Wishlist"'

echo "── giving without a name by default"
req art GET /api/me; has "art gives with his name to begin with" '"anonymousDefault":false'
req art PATCH /api/me '{"anonymousDefault":true}'; check "art turns it on" 200; has "… and gets it back" '"anonymousDefault":true'; has "… with his name as it was" '"displayName":"Art"'
req art GET /api/_auth/session; has "the page hears of it" '"anonymousDefault":true'
req art PATCH /api/me '{}'; check "a change with nothing in it is refused" 422
req art PATCH /api/me '{"anonymousDefault":false}'; check "art turns it off again" 200

echo "── another address"
req anon POST /api/me/email '{"email":"x@example.test"}'; check "asking for another address needs a login" 401
req art POST /api/me/email '{"email":"nope","currentPassword":"correct horse battery"}'; check "something that is no address is refused" 422; has "… naming the field" '"email":"invalid_email"'
req art POST /api/me/email '{"email":"mom@example.test","currentPassword":"correct horse battery"}'; check "art cannot take mom's address" 409; has "… with the code email_taken" email_taken
req art POST /api/me/email '{"email":"art@example.test","currentPassword":"correct horse battery"}'; check "… nor ask for the one he has" 409; has "… with the code email_same" email_same
req art POST /api/me/email '{"email":"art@new.test","currentPassword":"wrong wrong wrong"}'; check "a wrong password is refused" 403; has "… as wrong" wrong_password
req art POST /api/me/email '{"email":"art@new.test"}'; check "… and so is leaving it out" 403
req art POST /api/me/email '{"email":"art@new.test","currentPassword":"correct horse battery"}'; check "with his password, the mail goes out" 204
req art GET /api/me; has "… and his address stays until he clicks the link in it" '"email":"art@example.test"'

echo "── lists"
req art POST /api/lists '{"title":"Verjaardag"}'; check "art makes a list" 201; TOKEN=$(json .token)
if [ "${#TOKEN}" = 22 ]; then ok "… its token has 22 characters"; else bad "the token is \"$TOKEN\""; fi
has "… and the title comes back" '"title":"Verjaardag"'
req mom POST /api/lists '{"title":"Moeke haar lijst"}'; check "mom makes a list of her own" 201; MOMLIST=$(json .token)
req art POST /api/lists '{"title":"   "}'; check "a list without a title is refused" 422
req anon POST /api/lists '{"title":"x"}'; check "making a list needs a login" 401
req art PATCH "/api/lists/$TOKEN" '{"title":"Verjaardag Art"}'; check "art renames the list" 200; has "… and gets the new title back" '"title":"Verjaardag Art"'
req mom PATCH "/api/lists/$TOKEN" '{"title":"Gekaapt"}'; check "mom cannot rename art's list" 404
req art PATCH "/api/lists/$TOKEN" '{"note":"Maat 128, liever geen snoep."}'; check "art writes a note on the list" 200; has "… and gets it back" '"note":"Maat 128, liever geen snoep."'; has "… with the title kept" '"title":"Verjaardag Art"'
req anon GET "/api/lists/$TOKEN"; check "a visitor who isn't logged in opens the list" 200; has "… and reads the note" '"note":"Maat 128, liever geen snoep."'
req mom PATCH "/api/lists/$TOKEN" '{"note":"Gekaapt"}'; check "mom cannot change the note on art's list" 404
req art PATCH "/api/lists/$TOKEN" '{}'; check "a change to a list that names nothing is refused" 422
req art PATCH "/api/lists/$TOKEN" "{\"note\":\"$(printf 'x%.0s' $(seq 1001))\"}"; check "a note of 1001 characters is refused" 422; has "… with the code too_long" '"note":"too_long"'
req art PATCH "/api/lists/$TOKEN" '{"note":""}'; check "art empties the note" 200; has "… and it is gone" '"note":null'
req mom DELETE "/api/lists/$TOKEN"; check "mom cannot delete art's list" 404
req art GET /api/home; check "art opens the home page" 200; has "… and the list is there" "\"token\":\"$TOKEN\""

echo "── the owner builds a list"
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Slimme stekkers","description":"Zigbee","urls":["https://example.test/plug"],"quantity":3}'; check "art adds a wish with amount 3" 201; PLUGS=$(json .id)
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Puzzels","quantity":null}'; check "art adds an unlimited wish" 201; PUZZLES=$(json .id)
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Sokken"}'; check "art adds a wish with only a title" 201; SOCKS=$(json .id); has "… and the amount is one" '"quantity":1'
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Boek"}'; check "art adds a wish nobody will buy" 201; BOOK=$(json .id)
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Kwaad","urls":["javascript:alert(1)"]}'; check "a javascript: link is refused" 422
req anon POST "/api/lists/$TOKEN/wishes" '{"title":"x"}'; check "adding a wish needs a login" 401
req mom POST "/api/lists/$TOKEN/wishes" '{"title":"Ondergeschoven"}'; check "mom cannot add to art's list" 404
req mom PATCH "/api/lists/$TOKEN/wishes/$PLUGS" '{"title":"Gekaapt"}'; check "mom cannot change art's wish" 404
req mom DELETE "/api/lists/$TOKEN/wishes/$PLUGS"; check "mom cannot delete art's wish" 404
req mom POST "/api/lists/$TOKEN/wishes/delete" "{\"wishIds\":[$PLUGS]}"; check "mom cannot delete several of art's wishes" 404
req mom PUT "/api/lists/$TOKEN/order" "{\"wishIds\":[$PLUGS]}"; check "mom cannot reorder art's list" 404
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
req mom GET /api/home; same "mom's home page has what she gives, under who it is for, the last tick first" ".given.map(g=>g.names+': '+g.wishes.map(w=>w.title+' '+w.mine).join(', ')).join('; ')" "Art: Sokken 1, Slimme stekkers 2"
has "… each with the list to open it on" "\"token\":\"$TOKEN\",\"listTitle\":\"Verjaardag Art\",\"removed\":false"
lacks "… and nothing of what sis gives" Puzzels
req art GET /api/home; same "art's home page has nothing he gives, whatever was bought for him" ".given.length" 0
req anon GET /api/home; same "… and neither has a visitor's" ".given.length" 0

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
# page <who> [token]: the page of art's first list unless another token is given.
page() { STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -b "$TMP/$1.jar" -c "$TMP/$1.jar" "$BASE/l/${2:-$TOKEN}"); }
page art; check "art opens the page of his list" 200
for secret in Moeke Zus geheimpje; do lacks "… and the HTML has no '$secret'" "$secret"; done
page page-visitor; check "a visitor opens the page" 200
for secret in Moeke Zus geheimpje; do lacks "… and the HTML has no '$secret'" "$secret"; done
has "… and says what a chat app shows of the link: the list's name, which says whose it is" 'property="og:title" content="Verjaardag Art"'
has "… with the site's picture, by its whole address" "property=\"og:image\" content=\"$BASE/preview.png\""
status_of /preview.png; check "… which is there" 200
preview /en; has "the home page says what the site is, in the page's language" 'property="og:title" content="Pakske, wishlists for family and friends"'
page sis; check "sis opens the page" 200
has "… and the HTML names mom, who bought" Moeke; has "… and holds mom's note" geheimpje

echo "── the privacy page and the terms"
status_of /privacy; check "a visitor opens the privacy page" 200; has "… in Dutch" "Wie je gegevens bewaart"
status_of /en/privacy; check "… and the English one" 200; has "… in English" "Who keeps your data"
status_of /terms; check "a visitor opens the terms" 200; has "… which link to the privacy page" 'href="/privacy"'
status_of /en/terms; check "… and the English ones" 200; has "… which link to the English privacy page" 'href="/en/privacy"'
status_of /en/register; has "the form that makes an account links to the terms" 'href="/en/terms"'

echo "── the owner ticks his own wishes"
req art PUT "/api/lists/$TOKEN/wishes/$BOOK/purchase" '{"quantity":1}'; check "art ticks his own free wish" 204
req art GET "/api/lists/$TOKEN"; has "… and his list shows it as his" '"mine":1'
req art GET /api/home; same "… and his home page doesn't count it as something he gives" ".given.length" 0
for secret in purchases notes bought removed Moeke Zus geheimpje; do lacks "… and still has no '$secret'" "$secret"; done
req art PUT "/api/lists/$TOKEN/wishes/$SOCKS/purchase" '{"quantity":1}'; check "art ticks the socks mom already has" 409; has "… with the code quantity_exceeded" quantity_exceeded
REFUSAL=$(said)
if printf %s "$REFUSAL" | grep -q 'Moeke'; then bad "the refusal names mom: $REFUSAL"; else ok "… the refusal names nobody"; fi
if printf %s "$REFUSAL" | grep -q '[0-9]'; then bad "the refusal holds a number: $REFUSAL"; else ok "… and holds no number"; fi

echo "── the owner changes things buyers already acted on"
req art PATCH "/api/lists/$TOKEN/wishes/$PLUGS" '{"quantity":2}'; check "art lowers the amount below what is bought, sending only the amount" 200; has "… and gets the wish back" '"quantity":2'
has "… with its text kept" '"description":"Zigbee"'; has "… and its link" '"urls":["https://example.test/plug"]'
req art PATCH "/api/lists/$TOKEN/wishes/$PLUGS" '{}'; check "a change that names no field is refused" 422
req art DELETE "/api/lists/$TOKEN/wishes/$SOCKS"; check "art deletes the bought wish" 204
req art DELETE "/api/lists/$TOKEN/wishes/$SOCKS"; check "a second delete finds nothing" 404
req art DELETE "/api/lists/$TOKEN/wishes/$PUZZLES"; check "art deletes another bought wish, same answer" 204
req art GET "/api/lists/$TOKEN"; lacks "art no longer sees the socks" Sokken
req mom GET "/api/lists/$TOKEN"; has "mom, who bought the socks, still sees them" Sokken; has "… marked as removed" '"removed":true'
req mom GET /api/home; same "… and her home page marks them the same way" ".given[0].wishes.find(w=>w.title==='Sokken').removed" true
req sis GET "/api/lists/$TOKEN"; lacks "sis, who bought none of them, no longer sees the socks" Sokken; has "… but still the puzzles she bought" Puzzels
req sis POST "/api/lists/$TOKEN/wishes/$SOCKS/notes" '{"body":"Wie heeft ze?"}'; check "… and cannot write a note on them" 404
req sis PUT "/api/lists/$TOKEN/wishes/$SOCKS/purchase" '{"quantity":1}'; check "sis cannot newly buy a removed wish" 409; has "… with the code wish_removed" wish_removed
req sis PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":2}'; check "sis cannot raise on the lowered wish" 409
req mom PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":1}'; check "mom can lower on the lowered wish" 204

# Deleting with "gone for everyone right away": whoever bought it doesn't keep seeing it either.
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Kaarsje"}'; CANDLE=$(json .id)
req art POST "/api/lists/$TOKEN/wishes" '{"title":"Zeepje"}'; SOAP=$(json .id)
req mom PUT "/api/lists/$TOKEN/wishes/$CANDLE/purchase" '{"quantity":1}'; check "mom buys the candle" 204
req mom PUT "/api/lists/$TOKEN/wishes/$SOAP/purchase" '{"quantity":1}'; check "… and the soap" 204
req art DELETE "/api/lists/$TOKEN/wishes/$CANDLE" '{"clearForBuyers":"yes"}'; check "a delete that says it unclearly is refused" 422
req art DELETE "/api/lists/$TOKEN/wishes/$CANDLE" '{"clearForBuyers":true}'; check "art deletes the candle for whoever bought it as well, same answer" 204
req art POST "/api/lists/$TOKEN/wishes/delete" "{\"wishIds\":[$SOAP],\"clearForBuyers\":true}"; check "… and the soap, from edit mode" 204
req mom GET "/api/lists/$TOKEN"; lacks "mom no longer sees the candle" Kaarsje; lacks "… nor the soap" Zeepje; has "… but still the socks, deleted the usual way" Sokken
req mom GET /api/home; lacks "her home page has no candle either" Kaarsje; lacks "… nor the soap" Zeepje; has "… but still the socks" Sokken
req mom POST "/api/lists/$TOKEN/wishes/$CANDLE/notes" '{"body":"Waar is hij?"}'; check "… and cannot write a note on the candle" 404
req mom DELETE "/api/lists/$TOKEN/wishes/$CANDLE/purchase"; check "… but can still take back what she was giving" 204

echo "── images"
printf 'just text' > "$TMP/fake.png"
upload art "/api/lists/$TOKEN/wishes/$PLUGS/image" "$TMP/pic.png"; check "art uploads an image" 200; IMAGE=$(json .image)
upload art "/api/lists/$TOKEN/wishes/$PLUGS/image" "$TMP/fake.png"; check "a text file named .png is refused" 422
upload mom "/api/lists/$TOKEN/wishes/$PLUGS/image" "$TMP/pic.png"; check "mom cannot set the image of art's wish" 404
upload mom "/api/lists/$MOMLIST/wishes/$PLUGS/image" "$TMP/pic.png"; check "… nor through her own list" 404
upload art /api/me/image "$TMP/pic.png"; check "art puts up a profile picture" 200; ARTPIC=$(json .picture)
upload art /api/me/image "$TMP/fake.png"; check "a text file is no profile picture" 422
upload anon /api/me/image "$TMP/pic.png"; check "a profile picture needs a login" 401
req art GET /api/me; same "his account has it" ".picture" "$ARTPIC"
status_of "$ARTPIC"; check "… and it is served" 200
req art DELETE /api/me/image; check "he takes it away" 204
req art GET /api/me; same "… and has none" ".picture" null
status_of "$ARTPIC"; check "… and the file is gone" 404
upload art /api/me/image "$TMP/pic.png"; check "he puts one up again, for his friends later on" 200; ARTPIC=$(json .picture)
head -c 4000000 /dev/zero > "$TMP/big.png"
upload art "/api/lists/$TOKEN/wishes/$PLUGS/image" "$TMP/big.png"; check "a 4 MB upload is refused" 413
curl -s -D "$TMP/headers" -o /dev/null "$BASE$IMAGE"
if grep -qi 'immutable' "$TMP/headers" && grep -qi 'content-type: image/png' "$TMP/headers"; then ok "the image is served as image/png, cacheable forever"; else bad "image headers: $(cat "$TMP/headers")"; fi
if grep -qi '^cache-control: private' "$TMP/headers"; then ok "… by a browser only, not by a cache in between"; else bad "image cache headers: $(grep -i cache-control "$TMP/headers")"; fi
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' --path-as-is "$BASE/uploads/..%2f..%2fpakske.db"); check "a path outside the uploads folder is not found" 404
req mom DELETE "/api/lists/$TOKEN/wishes/$PLUGS/image"; check "mom cannot remove the image of art's wish" 404
req art DELETE "/api/lists/$TOKEN/wishes/$PLUGS/image"; check "art removes the image" 204
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' "$BASE$IMAGE"); check "the removed image is gone" 404

echo "── an import from a shop"
# On a list of its own, deleted afterwards, so art's lists stay as the checks below expect.
req art POST /api/lists '{"title":"Import"}'; IMPORT=$(json .token)
req art POST /api/import/read '{"text":"een fiets, zonder link"}'; check "a paste without a link is read, and gives nothing" 200; has "… no wishes" '"items":[]'; has "… and no unread links" '"unread":[]'
req art POST /api/import/read '{"text":"kijk: https://example.test/lamp."}'; check "a link to a shop that doesn't exist is read" 200; has "… and comes back as unread" '"unread":["https://example.test/lamp"]'
req art POST /api/import/read '{"text":"  "}'; check "an empty paste is refused" 422
req anon POST /api/import/read '{"text":"https://example.test/lamp"}'; check "reading a paste needs a login" 401
req art POST "/api/lists/$IMPORT/wishes/import" '{"items":[{"title":"Lamp","url":"https://example.test/lamp"},{"title":"Boek","url":"https://example.test/boek","image":"https://example.test/boek.jpg"}]}'; check "art imports two wishes" 201; has "… and hears how many went on" '"added":2'
req art GET "/api/lists/$IMPORT"; has "… the first with its link" '"title":"Lamp","description":null,"urls":["https://example.test/lamp"]'; has "… and the second under it" '"title":"Boek","description":null,"urls":["https://example.test/boek"]'
req art POST "/api/lists/$IMPORT/wishes/import" '{"items":[]}'; check "an import of nothing is refused" 422
req art POST "/api/lists/$IMPORT/wishes/import" '{"items":[{"title":"Kwaad","url":"javascript:alert(1)"}]}'; check "an imported javascript: link is refused" 422
req art POST "/api/lists/$IMPORT/wishes/import" '{"items":[{"title":"Lamp","url":"https://example.test/lamp","quantity":5}]}'; check "an imported wish takes nothing but a title, a link and a picture" 422
req mom POST "/api/lists/$IMPORT/wishes/import" '{"items":[{"title":"Ondergeschoven","url":"https://example.test/x"}]}'; check "mom cannot import into art's list" 404
req anon POST "/api/lists/$IMPORT/wishes/import" '{"items":[{"title":"x","url":"https://example.test/x"}]}'; check "importing needs a login" 401
req art GET "/api/lists/$IMPORT"; lacks "… and none of those went on" 'Ondergeschoven'; lacks "… nor the refused one" 'Kwaad'
req art DELETE "/api/lists/$IMPORT"; check "art deletes the import list" 204

echo "── several links, and the first link's cover"
# On a list of its own, deleted afterwards, so art's lists stay as the checks below expect.
req art POST /api/lists '{"title":"Links"}'; LINKS=$(json .token)
req art POST "/api/lists/$LINKS/wishes" '{"title":"Lamp","urls":["https://example.test/lamp","https://example.org/lamp"]}'; check "art adds a wish with two links" 201; LAMPLINKS=$(json .id)
has "… and gets them back in order" '"urls":["https://example.test/lamp","https://example.org/lamp"]'; has "… without a cover, as that shop doesn't exist" '"image":null'
req art PATCH "/api/lists/$LINKS/wishes/$LAMPLINKS" '{"urls":["https://example.org/lamp"]}'; check "art replaces the links with one" 200; has "… and gets that one back" '"urls":["https://example.org/lamp"]'; has "… with the title kept" '"title":"Lamp"'
req art PATCH "/api/lists/$LINKS/wishes/$LAMPLINKS" '{"urls":["https://a.test/1","https://a.test/2","https://a.test/3","https://a.test/4","https://a.test/5","https://a.test/6"]}'; check "a sixth link is refused" 422; has "… with the code too_many_links" '"urls":"too_many_links"'
req art PATCH "/api/lists/$LINKS/wishes/$LAMPLINKS" '{"urls":["https://a.test/1","https://a.test/1"]}'; check "the same link twice is refused" 422; has "… with the code duplicate_link" '"urls":"duplicate_link"'
req art PATCH "/api/lists/$LINKS/wishes/$LAMPLINKS" '{"urls":["https://a.test/1","javascript:alert(1)"]}'; check "a javascript: link among them is refused" 422; has "… with the code invalid_url" '"urls":"invalid_url"'
req art PATCH "/api/lists/$LINKS/wishes/$LAMPLINKS" '{"urls":"https://a.test/1"}'; check "links that are not a list are refused" 422
# The server never fetches from itself or the network it stands in. The link is saved all the same,
# and the answer says nothing about why there is no picture.
for inside in "$BASE/" "http://127.0.0.1/" "http://localhost/" "http://192.168.1.1/" "http://169.254.169.254/latest/meta-data/" "http://[::1]/" "http://2130706433/"; do
  req art PATCH "/api/lists/$LINKS/wishes/$LAMPLINKS" "{\"urls\":[\"$inside\"]}"; check "art links to $inside" 200
  has "… and it is saved" '"urls":["'; has "… without a picture" '"image":null'; has "… and nothing marked as a cover" '"imageFromLink":false'
  lacks "… and without a reason" private; lacks "… or an error" rror
done
req art GET "/api/lists/$LINKS"; has "the list shows the wish with its links" '"urls":["'
req art PATCH "/api/lists/$LINKS/wishes/$LAMPLINKS" '{"urls":[]}'; check "art clears the links" 200; has "… and none are left" '"urls":[]'
upload art "/api/lists/$LINKS/wishes/$LAMPLINKS/image" "$TMP/pic.png"; check "art puts up a photo of his own" 200
req art PATCH "/api/lists/$LINKS/wishes/$LAMPLINKS" '{"urls":["https://example.test/lamp"]}'; check "a link added afterwards" 200; lacks "… leaves the photo alone" '"image":null'; has "… and it stays his own" '"imageFromLink":false'
req art DELETE "/api/lists/$LINKS/wishes/$LAMPLINKS/image"; check "art removes his photo from a wish with a link" 204
req art DELETE "/api/lists/$LINKS"; check "art deletes the list again" 204

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

echo "── the home page's five and the lists page"
# Counts of own lists are "at least": an account may start with a list of its own.
register veel Veel; check "veel registers" 201
register kijker Kijker; check "kijker registers" 201
V=()
for i in 1 2 3 4 5 6; do req veel POST /api/lists "{\"title\":\"Lijst $i\"}"; V+=("$(json .token)"); done
req veel GET /api/home; check "veel opens the home page" 200
same "… which shows five of her lists" ".owned.length" 5; same "… the newest first" ".owned[0].title" "Lijst 6"
same "… and says how many she has" ".ownedTotal>=6" true; lacks "… without the oldest of the six" "${V[0]}"
req veel GET /api/lists; check "veel opens the lists page" 200; has "… which has the oldest too" "${V[0]}"
same "… and every list she owns" ".owned.length>=6" true; same "… each with its owners' names" ".owned[0].owners.join()" Veel
req veel GET "/api/lists/${V[0]}"; check "veel opens her oldest list" 200
req veel GET /api/home; same "… and it is the first on her home page" ".owned[0].title" "Lijst 1"
same "… and not among the visited ones" ".opened.length" 0; same "… of which she has none" ".openedTotal" 0
for token in "${V[@]}"; do req kijker GET "/api/lists/$token"; done
req kijker GET /api/home; same "kijker's home page shows five visited lists" ".opened.length" 5
same "… of six" ".openedTotal" 6; same "… the one opened last first" ".opened[0].title" "Lijst 6"
req kijker GET /api/lists; same "kijker's lists page has all six" ".opened.length" 6; same "… with whose they are" ".opened[5].owners.join()" Veel
lacks "… and no list kijker never opened" "$MOMLIST"
req lists-visitor GET "/api/lists/$TOKEN"
req lists-visitor GET /api/lists; check "a visitor who isn't logged in opens the lists page" 200
has "… owning nothing" '"owned":[]'; has "… with the list this browser opened" "\"token\":\"$TOKEN\""; lacks "… and no other" "$MOMLIST"

# From here on, joint wishes and lists, on lists of their own, so art's first list stays as the
# comparisons above left it.
echo "── a link that makes wishes joint"
req lot POST /api/lists '{"title":"Lotte haar lijst"}'; check "lot makes a list" 201; LOTLIST=$(json .token)
req sis POST /api/lists '{"title":"Zus haar lijst"}'; check "sis makes a list" 201; SISLIST=$(json .token)
req art POST /api/lists '{"title":"Kerst"}'; check "art makes a second list" 201; XMAS=$(json .token)
req art POST "/api/lists/$XMAS/wishes" '{"title":"Speelgoedtrein","quantity":3}'; check "art adds a wish with amount 3" 201; TRAIN=$(json .id)
req art POST "/api/lists/$XMAS/wishes" '{"title":"Lamp"}'; check "art adds a lamp" 201; LAMP=$(json .id)
upload art "/api/lists/$XMAS/wishes/$LAMP/image" "$TMP/pic.png"; check "… with a picture" 200; LAMPIMG=$(json .image)
req art POST "/api/lists/$XMAS/wishes" '{"title":"Vaas"}'; check "art adds a vase" 201; VASE=$(json .id)
upload art "/api/lists/$XMAS/wishes/$VASE/image" "$TMP/pic.png"; check "… with a picture" 200; VASEIMG=$(json .image)
req art POST "/api/lists/$XMAS/invites" "{\"kind\":\"wishes\",\"mode\":\"linked\",\"wishIds\":[$TRAIN]}"; check "art makes a link for the train" 201; INVITE=$(json .invite)
preview "/j/$INVITE"; check "a chat app that fetches the link gets the login page" 200; has "… which says something is shared" 'property="og:title" content="Iemand deelt iets met je op Pakske"'; has "… at the link's own address" "property=\"og:url\" content=\"$BASE/j/$INVITE\""; lacks "… and not what" Speelgoedtrein
if [ "${#INVITE}" = 22 ]; then ok "… its token has 22 characters"; else bad "the link's token is \"$INVITE\""; fi
if [ "$INVITE" != "$XMAS" ]; then ok "… and is not the list's token"; else bad "the link hands out the list's token"; fi
req mom POST "/api/lists/$XMAS/invites" "{\"kind\":\"wishes\",\"mode\":\"linked\",\"wishIds\":[$TRAIN]}"; check "mom cannot make a link on art's list" 404
req art POST "/api/lists/$XMAS/invites" "{\"kind\":\"wishes\",\"mode\":\"linked\",\"wishIds\":[$TRAIN,$BOOK]}"; check "a link with a wish of another list is not found" 404
req art POST "/api/lists/$XMAS/invites" '{"kind":"wishes","wishIds":[]}'; check "a link for no wishes is refused" 422
req anon POST "/api/lists/$XMAS/invites" '{"kind":"list"}'; check "making a link needs a login" 401

echo "── opening the link"
req anon GET "/api/invites/$INVITE"; check "a visitor who isn't logged in gets 401" 401
req lot GET "/api/invites/$UNKNOWN"; check "a well-formed token no link has is not found" 404
req lot GET "/api/invites/not-a-token"; check "a malformed one too" 404
req lot GET "/api/invites/$INVITE"; check "lot opens it" 200
has "… and it is open" '"state":"open"'; has "… from Art" '"from":"Art"'; has "… with the train" '"title":"Speelgoedtrein"'; has "… which she doesn't own yet" '"owned":false'; has "… to share, not to copy" '"mode":"linked"'
has "… and her own lists to choose from" "\"token\":\"$LOTLIST\""; lacks "… and no trace of art's list token" "$XMAS"
req art GET "/api/invites/$INVITE"; check "art opens his own link" 200; has "… and is told it is his" '"state":"own"'
req art POST "/api/invites/$INVITE/accept" '{"newList":"Van mezelf"}'; check "art cannot use his own link" 403
req anon POST "/api/invites/$INVITE/accept" "{\"list\":\"$LOTLIST\"}"; check "using a link needs a login" 401
req lot POST "/api/invites/$INVITE/accept" '{}'; check "wishes need a list to go on" 422
req lot POST "/api/invites/$INVITE/accept" "{\"list\":\"$LOTLIST\"}"; check "lot puts the train on her list" 200
has "… and is sent to that list" "\"token\":\"$LOTLIST\""
req mom POST "/api/invites/$INVITE/accept" "{\"list\":\"$MOMLIST\"}"; check "the link works once" 409; has "… with the code invite_closed" invite_closed
req lot GET "/api/invites/$INVITE"; has "… and now says it is closed" '"state":"closed"'; lacks "… showing no wishes" Speelgoedtrein

echo "── notices"
req art GET /api/notices; check "art opens his notices" 200; has "… and is told Lotte used his link" '"kind":"joint_link_used","actor":"Lotte"'
req art GET /api/notices/unseen; check "art asks how many notices are new" 200; has "… one" '"unseen":1'
req art POST /api/notices/seen; check "art has seen them" 204
req art GET /api/notices/unseen; has "… and none are new" '"unseen":0'
req anon GET /api/notices/unseen; check "notices need a login" 401
req anon POST /api/notices/seen; check "… seeing them too" 401
req anon GET /api/notices; check "… and reading them" 401
req art GET /api/home; lacks "the home page carries no notices any more" '"notices"'

echo "── two people use one link at the same moment"
req art POST /api/lists '{"title":"Ruimte"}'; RACELIST=$(json .token)
req art POST "/api/lists/$RACELIST/wishes" '{"title":"Raket"}'; ROCKET=$(json .id)
req art POST "/api/lists/$RACELIST/invites" "{\"kind\":\"wishes\",\"mode\":\"linked\",\"wishIds\":[$ROCKET]}"; RACEINVITE=$(json .invite)
for who in lot mom; do
  curl -s -o /dev/null -w '%{http_code}' -X POST -b "$TMP/$who.jar" -H 'Content-Type: application/json' \
    --data "{\"newList\":\"Raket voor $who\"}" "$BASE/api/invites/$RACEINVITE/accept" > "$TMP/race-$who" &
done
wait
RACE=$(printf '%s\n%s\n' "$(cat "$TMP/race-lot")" "$(cat "$TMP/race-mom")" | sort | tr '\n' ' ')
if [ "$RACE" = "200 409 " ]; then ok "exactly one of them gets it"; else bad "racing for the link gave: $RACE"; fi
req mom GET "/api/invites/$RACEINVITE"; has "… and afterwards the link says it is closed" '"state":"closed"'
req art POST /api/notices/seen

echo "── a link that gives copies"
req art POST /api/lists '{"title":"Kopieën"}'; COPYLIST=$(json .token)
req art POST "/api/lists/$COPYLIST/wishes" '{"title":"Puzzel"}'; PUZZLE=$(json .id)
req art POST "/api/lists/$COPYLIST/wishes" '{"title":"Kaars"}'; CANDLE=$(json .id)
req art POST "/api/lists/$COPYLIST/invites" "{\"kind\":\"wishes\",\"wishIds\":[$PUZZLE,$CANDLE]}"; check "art makes a link without saying how" 201; COPYINVITE=$(json .invite)
req art POST "/api/lists/$COPYLIST/invites" "{\"kind\":\"wishes\",\"mode\":\"both\",\"wishIds\":[$PUZZLE]}"; check "a way of sharing that doesn't exist is refused" 422
req art POST "/api/lists/$COPYLIST/invites" '{"kind":"list","mode":"copy"}'; check "a list can't be shared as a copy" 422
req guest GET "/api/invites/$COPYINVITE"; check "oma opens it" 200; has "… and it gives copies" '"mode":"copy"'; has "… of the puzzle, which isn't hers" '"title":"Puzzel","image":null,"owned":false'; has "… and of the candle" Kaars; lacks "… without the list's token" "$COPYLIST"
req art GET "/api/invites/$COPYINVITE"; has "art is told it is his" '"state":"own"'
req art POST "/api/invites/$COPYINVITE/accept" '{"newList":"Van mezelf"}'; check "… and cannot use it" 403
req guest POST "/api/invites/$COPYINVITE/accept" "{\"newList\":\"Van oma\",\"wishIds\":[$PUZZLE,$LAMP]}"; check "a wish the link isn't for is not found" 404
req guest POST "/api/invites/$COPYINVITE/accept" '{"newList":"Van oma","wishIds":[]}'; check "choosing nothing is refused" 422
req guest POST "/api/invites/$COPYINVITE/accept" "{\"newList\":\"Van oma\",\"wishIds\":[$PUZZLE,$PUZZLE]}"; check "… and so is choosing a wish twice" 422
req guest GET /api/me/lists; lacks "none of that made the new list" "Van oma"
req guest POST "/api/invites/$COPYINVITE/accept" "{\"newList\":\"Van oma\",\"wishIds\":[$PUZZLE]}"; check "oma takes the puzzle only" 200; OMALIST=$(json .token)
req guest GET "/api/lists/$OMALIST"; has "… and has a puzzle" '"title":"Puzzel"'; has "… as its owner" '"role":"owner"'; lacks "… which is not art's wish" "\"id\":$PUZZLE,"; lacks "… and no candle" Kaars
req guest GET "/api/lists/$COPYLIST"; has "oma still sees art's puzzle" "\"id\":$PUZZLE,"; lacks "… as a buyer, not an owner" '"role":"owner"'
req guest POST "/api/invites/$COPYINVITE/accept" "{\"list\":\"$OMALIST\"}"; check "the link works once for her" 409; has "… with the code invite_closed" invite_closed
req guest GET "/api/invites/$COPYINVITE"; has "… and says she used it" '"state":"used"'; lacks "… showing no wishes" Kaars
req opa POST "/api/invites/$COPYINVITE/accept" '{"newList":"Van opa"}'; check "opa can still use it, for both wishes" 200; OPALIST=$(json .token)
req opa GET "/api/lists/$OPALIST"; has "… and gets the puzzle" Puzzel; has "… and the candle" Kaars
req art GET /api/notices/unseen; has "art is not told about any of it" '"unseen":0'

echo "── a joint wish, bought through both lists"
req art GET "/api/lists/$XMAS"; cp "$BODY" "$TMP/xmas-art-before"
same "art owns the train" ".wishes.find(w=>w.id===$TRAIN).role" owner
req lot GET "/api/lists/$LOTLIST"; cp "$BODY" "$TMP/lot-before"
same "lot owns it too, on her list" ".wishes.find(w=>w.id===$TRAIN).role" owner
req anon GET "/api/lists/$XMAS"; cp "$BODY" "$TMP/xmas-anon-before"
req anon GET "/api/lists/$LOTLIST"; cp "$BODY" "$TMP/lot-anon-before"
req mom PUT "/api/lists/$XMAS/wishes/$TRAIN/purchase" '{"quantity":1}'; check "mom buys one through art's list" 204
req sis PUT "/api/lists/$LOTLIST/wishes/$TRAIN/purchase" '{"quantity":1}'; check "sis buys one through lot's list" 204
req mom POST "/api/lists/$XMAS/wishes/$TRAIN/notes" '{"body":"Ik regel de bel, fluistertip."}'; check "mom writes a note" 201
req sis POST "/api/lists/$LOTLIST/wishes/$TRAIN/notes" '{"body":"Ik neem de rails, verrassingsplan."}'; check "sis writes a note" 201
req lot PUT "/api/lists/$LOTLIST/wishes/$TRAIN/purchase" '{"quantity":1}'; check "lot ticks one herself" 204
req art GET "/api/lists/$XMAS"
if cmp -s "$BODY" "$TMP/xmas-art-before"; then ok "art's list is byte for byte what it was"; else bad "art's list changed after others bought, ticked and wrote"; fi
for secret in purchases notes bought Moeke Zus fluistertip verrassingsplan; do lacks "… and has no '$secret'" "$secret"; done
req lot GET "/api/lists/$LOTLIST"
CHANGED=$(diff <(lines "$TMP/lot-before") <(lines "$BODY") | grep '^[<>]' | tr -d ' ,\n')
if [ "$CHANGED" = '<"mine":0>"mine":1' ]; then ok "lot's list differs only by her own tick"; else bad "lot's list changed by: $CHANGED"; fi
for secret in purchases notes bought Moeke Zus fluistertip verrassingsplan; do lacks "… and has no '$secret'" "$secret"; done
req anon GET "/api/lists/$XMAS"
if cmp -s "$BODY" "$TMP/xmas-anon-before"; then ok "a visitor gets art's list byte for byte as before"; else bad "the visitor's view of art's list changed"; fi
req anon GET "/api/lists/$LOTLIST"
if cmp -s "$BODY" "$TMP/lot-anon-before"; then ok "… and lot's list"; else bad "the visitor's view of lot's list changed"; fi
for who in mom sis; do
  [ "$who" = mom ] && list=$XMAS || list=$LOTLIST
  req $who GET "/api/lists/$list"; check "$who opens the list she bought through" 200
  has "… and sees all three bought" '"bought":3'
  for name in Moeke Zus Lotte; do has "… by $name" "\"name\":\"$name\""; done
  for text in fluistertip verrassingsplan; do has "… and the note with '$text'" "$text"; done
done

echo "── the pages of the joint wish's lists"
for list in "$XMAS" "$LOTLIST"; do
  for who in art lot page-visitor; do
    page $who "$list"; check "$who opens the page of $([ "$list" = "$XMAS" ] && echo "art's" || echo "lot's") list" 200
    for secret in Moeke Zus fluistertip verrassingsplan; do lacks "… and the HTML has no '$secret'" "$secret"; done
  done
  page mom "$list"; check "mom opens it" 200
  for secret in Moeke Zus fluistertip verrassingsplan; do has "… and the HTML has '$secret'" "$secret"; done
done

echo "── the owners of a joint wish"
req art PUT "/api/lists/$XMAS/wishes/$TRAIN/purchase" '{"quantity":1}'; check "art ticks the train, which is gone" 409; has "… with the code quantity_exceeded" quantity_exceeded
REFUSAL=$(said)
if printf %s "$REFUSAL" | grep -qE 'Moeke|Zus|Lotte'; then bad "the refusal names someone: $REFUSAL"; else ok "… the refusal names nobody"; fi
if printf %s "$REFUSAL" | grep -q '[0-9]'; then bad "the refusal holds a number: $REFUSAL"; else ok "… and holds no number"; fi
req lot POST "/api/lists/$LOTLIST/wishes/$TRAIN/notes" '{"body":"Wie koopt hem?"}'; check "lot cannot write a note on it" 403
req lot PATCH "/api/lists/$XMAS/wishes/$TRAIN" '{"description":"Met bel"}'; check "lot changes it through art's list" 200
req art GET "/api/lists/$XMAS"; has "… and art sees the change" '"description":"Met bel"'

echo "── Linked"
req sis POST "/api/lists/$XMAS/wishes/$LAMP/link" "{\"list\":\"$SISLIST\"}"; check "sis puts art's lamp on her list, linked" 201
has "… and is told which list" "\"token\":\"$SISLIST\""; same "… and that it is the same wish" .wishId "$LAMP"
req sis POST "/api/lists/$XMAS/wishes/$LAMP/link" "{\"list\":\"$SISLIST\"}"; check "she cannot link it twice" 403
req art POST "/api/lists/$XMAS/wishes/$LAMP/copy" "{\"list\":\"$XMAS\"}"; check "art cannot add his own wish to his list" 403
req anon POST "/api/lists/$XMAS/wishes/$LAMP/link" "{\"list\":\"$SISLIST\"}"; check "linking needs a login" 401
req mom POST "/api/lists/$XMAS/wishes/$LAMP/link" '{"list":""}'; check "a link without a list is refused" 422
req mom POST "/api/lists/$XMAS/wishes/$SOCKS/link" "{\"list\":\"$MOMLIST\"}"; check "a wish of another list is not found" 404
req art GET /api/notices
same "art is told, with undo" ".notices.find(n=>n.kind==='wish_linked').canUndo" true
same "… by Zus" ".notices.find(n=>n.kind==='wish_linked').actor" Zus
SIS_ID=$(json ".notices.find(n=>n.kind==='wish_linked').actorId")
req sis PATCH "/api/lists/$SISLIST/wishes/$LAMP" '{"title":"Leeslamp"}'; check "sis renames it through her own list" 200
upload sis "/api/lists/$SISLIST/wishes/$LAMP/image" "$TMP/pic.png"; check "… and gives it a picture of her own" 200; SISIMG=$(json .image)
req art GET "/api/lists/$XMAS"; has "art's list shows the new title" '"title":"Leeslamp"'
req mom POST "/api/lists/$XMAS/wishes/$LAMP/owners/$SIS_ID/undo"; check "mom, who holds no notice, cannot undo it" 404
req art POST "/api/lists/$XMAS/wishes/$LAMP/owners/$SIS_ID/undo"; check "art undoes the link" 204
req art GET "/api/lists/$XMAS"; has "… and his list has the old title" '"title":"Lamp"'; lacks "… not the new one" Leeslamp; has "… and the old picture" "$LAMPIMG"
status_of "$LAMPIMG"; check "the old picture is still there" 200
status_of "$SISIMG"; check "the picture sis set is gone" 404
req sis GET "/api/lists/$SISLIST"
same "sis's list has a copy with the old title" ".wishes.filter(w=>w.title==='Lamp').map(w=>w.id===$LAMP?'the wish':'a copy').join()" "a copy"
req sis GET /api/notices; has "sis is told she was unlinked" '"kind":"wish_unlinked","actor":"Art"'
req art POST "/api/lists/$XMAS/wishes/$LAMP/owners/$SIS_ID/undo"; check "a second undo finds nothing" 404

echo "── Copy"
req art POST /api/notices/seen
req mom POST "/api/lists/$XMAS/wishes/$VASE/copy" "{\"list\":\"$MOMLIST\"}"; check "mom copies the vase to her list" 201; COPY=$(json .wishId)
if [ -n "$COPY" ] && [ "$COPY" != "$VASE" ]; then ok "… as a wish of its own"; else bad "the copy is wish \"$COPY\""; fi
req mom GET "/api/lists/$MOMLIST"; same "… which she owns" ".wishes.find(w=>w.id===$COPY).role" owner
same "… with the same picture" ".wishes.find(w=>w.id===$COPY).image" "$VASEIMG"
req art GET /api/notices/unseen; has "art is not told" '"unseen":0'
req art GET /api/notices; lacks "… and has no notice about the vase" Vaas
upload mom "/api/lists/$MOMLIST/wishes/$COPY/image" "$TMP/pic.png"; check "mom replaces the picture on her copy" 200
status_of "$VASEIMG"; check "… and art's picture is still there" 200
req art GET "/api/lists/$XMAS"; has "… on his vase" "$VASEIMG"

echo "── the lists a wish can go on"
req lot GET /api/me/lists; check "lot asks for her lists" 200; has "… and gets hers" "\"token\":\"$LOTLIST\""; has "… and which one was used last" '"last":'
lacks "… and not art's" "$XMAS"
req anon GET /api/me/lists; check "that needs a login" 401

echo "── unlinking"
req lot GET "/api/lists/$LOTLIST"; ART_ID=$(json ".wishes.find(w=>w.id===$TRAIN).coOwners[0].id")
same "lot may not unlink art" ".wishes.find(w=>w.id===$TRAIN).coOwners[0].canUnlink" false
req art GET "/api/lists/$XMAS"; LOT_ID=$(json ".wishes.find(w=>w.id===$TRAIN).coOwners[0].id")
same "art may unlink lot" ".wishes.find(w=>w.id===$TRAIN).coOwners[0].canUnlink" true
req lot DELETE "/api/lists/$LOTLIST/wishes/$TRAIN/owners/$ART_ID"; check "lot cannot unlink art, who was there first" 403
req mom DELETE "/api/lists/$XMAS/wishes/$TRAIN/owners/$LOT_ID"; check "mom cannot unlink anyone" 404
req art DELETE "/api/lists/$XMAS/wishes/$TRAIN/owners/$LOT_ID"; check "art unlinks lot" 204
req lot GET "/api/lists/$LOTLIST"
same "lot's list has a copy, nothing ticked" ".wishes.filter(w=>w.title==='Speelgoedtrein').map(w=>(w.id===$TRAIN?'the wish':'a copy')+' '+w.role+' '+w.mine).join()" "a copy owner 0"
req lot GET /api/notices; has "lot is told she was unlinked" '"kind":"wish_unlinked","actor":"Art"'
req sis GET "/api/lists/$LOTLIST"; same "sis, who bought through lot's list, still gets the train there" ".wishes.find(w=>w.id===$TRAIN).removed" true
req sis PUT "/api/lists/$LOTLIST/wishes/$TRAIN/purchase" '{"quantity":2}'; check "… cannot raise" 409; has "… with the code wish_removed" wish_removed
req sis DELETE "/api/lists/$LOTLIST/wishes/$TRAIN/purchase"; check "… and can withdraw" 204
req art DELETE "/api/lists/$XMAS/wishes/$TRAIN/owners/$LOT_ID"; check "unlinking her again finds nothing" 404

echo "── taking a joint wish off one list"
upload art "/api/lists/$XMAS/wishes/$TRAIN/image" "$TMP/pic.png"; check "art gives the train a picture" 200; TRAINIMG=$(json .image)
req lot POST "/api/lists/$XMAS/wishes/$TRAIN/link" "{\"list\":\"$LOTLIST\"}"; check "lot links the train again" 201
upload lot "/api/lists/$LOTLIST/wishes/$TRAIN/image" "$TMP/pic.png"; check "… and replaces its picture" 200
status_of "$TRAINIMG"; check "art's picture stays while the link may still put it back" 200
req art GET /api/notices; RELINKED=$(json ".notices.find(n=>n.kind==='wish_linked').id")
req art DELETE "/api/notices/$RELINKED"; check "art dismisses the notice" 204
status_of "$TRAINIMG"; check "… and then it is gone" 404
req art DELETE "/api/notices/$RELINKED"; check "a second dismiss finds nothing" 404
req lot DELETE "/api/lists/$LOTLIST/wishes/$TRAIN"; check "lot takes the train off her list" 204
req art GET "/api/lists/$XMAS"; same "… and it is still on art's list, as his" ".wishes.find(w=>w.id===$TRAIN).role" owner

echo "── a list with two owners"
req art POST /api/lists '{"title":"Samen"}'; check "art makes a list" 201; JOINT=$(json .token)
req art POST "/api/lists/$JOINT/invites" '{"kind":"list"}'; check "art makes a link for the whole list" 201; LISTINVITE=$(json .invite)
req lot GET "/api/invites/$LISTINVITE"; check "lot opens it" 200; has "… and it is for a list" '"kind":"list"'; lacks "… without the list's token" "$JOINT"
req lot POST "/api/invites/$LISTINVITE/accept" '{}'; check "lot accepts" 200; has "… and is sent to the list" "\"token\":\"$JOINT\""
req lot POST "/api/invites/$LISTINVITE/accept" '{}'; check "she can't join a list she owns" 403
req art POST "/api/lists/$JOINT/invites" '{"kind":"list"}'; same "asked again, art gets the link that is going round" ".invite" "$LISTINVITE"
req mom POST "/api/invites/$LISTINVITE/accept" '{}'; check "the same link lets mom in too" 200
req art GET "/api/lists/$JOINT"; same "art sees his two co-owners, and may remove both" ".coOwners.filter(o=>o.canRemove).length" 2; MOM_ID=$(json ".coOwners[1].id"); JLOT_ID=$(json ".coOwners[0].id")
req anon GET "/api/lists/$JOINT"; lacks "a visitor gets no co-owners with ids" coOwners
req mom DELETE "/api/lists/$JOINT/owners/$JLOT_ID"; check "mom cannot remove lot, who was there before her" 403
req sis DELETE "/api/lists/$JOINT/owners/$MOM_ID"; check "someone who doesn't own the list can remove nobody" 404
req lot DELETE "/api/lists/$JOINT/owners/$MOM_ID"; check "lot removes mom, who joined after her" 204
req mom GET /api/notices; has "mom is told" '"kind":"list_removed","actor":"Lotte"'
req mom GET "/api/invites/$LISTINVITE"; check "… and the link that let her in is gone" 404
req lot DELETE "/api/lists/$JOINT/owners/$MOM_ID"; check "removing her again finds no co-owner" 404
req lot GET /api/home; has "lot's home page has it, shared with Art" "\"token\":\"$JOINT\",\"title\":\"Samen\",\"wishes\":0,\"owners\":[\"Art\",\"Lotte\"],\"sharedWith\":[\"Art\"]"
same "… as the first of her lists, since she just joined it" ".owned[0].token" "$JOINT"
req art GET /api/notices; has "art is told Lotte joined" '"kind":"list_joined","actor":"Lotte"'
req art GET /api/lists; has "… and his row names her" '"title":"Samen","wishes":0,"owners":["Art","Lotte"],"sharedWith":["Lotte"]'
req lot POST "/api/lists/$JOINT/wishes" '{"title":"Picknickmand"}'; check "lot adds a wish" 201; BASKET=$(json .id)
req art GET "/api/lists/$JOINT"; same "… and it is art's too" ".wishes.find(w=>w.id===$BASKET).role" owner
req art DELETE "/api/lists/$JOINT"; check "art cannot delete a list lot owns too" 409; has "… with the code list_shared" list_shared
req mom POST "/api/lists/$JOINT/leave"; check "mom cannot leave a list that isn't hers" 404
req lot POST "/api/lists/$JOINT/leave"; check "lot leaves it" 204
req lot GET /api/lists; lacks "… and it is gone from her lists: she never opened it, so it isn't a visited one either" "$JOINT"
req art POST "/api/lists/$JOINT/leave"; check "art cannot leave as the last owner" 409; has "… with the code last_owner" last_owner
req art DELETE "/api/lists/$JOINT"; check "art deletes it" 204

echo "── dismissing notices"
req lot GET /api/notices; LOTNOTICE=$(json ".notices[0].id")
req art GET /api/notices; NOTICE=$(json ".notices.find(n=>n.kind==='list_joined').id")
req art DELETE "/api/notices/$LOTNOTICE"; check "art cannot dismiss lot's notice" 404
req anon DELETE "/api/notices/$NOTICE"; check "dismissing needs a login" 401
req art DELETE "/api/notices/$NOTICE"; check "art dismisses his own" 204
req art DELETE "/api/notices/$NOTICE"; check "… and a second time finds nothing" 404
req lot GET /api/notices; has "lot's notice is still there" "\"id\":\"$LOTNOTICE\""
req anon POST /api/notices/dismiss "{\"ids\":[\"$LOTNOTICE\"]}"; check "clearing notices needs a login" 401
req art POST /api/notices/dismiss '{"ids":[]}'; check "clearing none is refused" 422
req art POST /api/notices/dismiss "{\"ids\":[\"$LOTNOTICE\"]}"; check "art clears lot's notice, and nothing happens" 204
req lot GET /api/notices; has "… it is still there" "\"id\":\"$LOTNOTICE\""
req lot POST /api/notices/dismiss "{\"ids\":[\"$LOTNOTICE\",\"no-such-notice\"]}"; check "lot clears her own, with an id nobody has" 204
req lot GET /api/notices; lacks "… and it is gone" "\"id\":\"$LOTNOTICE\""

echo "── friends"
req art POST /api/lists '{"title":"Voor vrienden"}'; check "art makes a list to show to friends" 201; FLIST=$(json .token)
req anon GET /api/friends; check "the friends page needs a login" 401
req anon POST /api/friends/links; check "… and so does making a friend link" 401
req anon POST "/api/lists/$FLIST/friend-requests" '{"owner":1}'; check "… and asking someone" 401
req anon GET "/api/lists/$FLIST/friends"; check "… and seeing who a list is shown to" 401
req anon GET "/api/lists/$FLIST"; same "a visitor is offered nobody to befriend" ".ownersToBefriend.length" 0
req art GET "/api/lists/$FLIST"; same "… and neither is the list's owner" ".ownersToBefriend.length" 0
req mom GET "/api/lists/$FLIST"; check "mom opens art's list" 200; has "… and may ask its owner" '"name":"Art","state":"none"'; FART=$(json ".ownersToBefriend[0].id")
req sis GET "/api/lists/$MOMLIST"; FMOM=$(json ".ownersToBefriend[0].id")
req mom POST "/api/lists/$FLIST/friend-requests" "{\"owner\":$FART}"; check "mom asks art to be friends" 200; has "… and it waits" '"state":"asked"'
req mom POST "/api/lists/$FLIST/friend-requests" "{\"owner\":$FART}"; check "asking again answers the same" 200; has "… still waiting" '"state":"asked"'
req mom POST "/api/lists/$FLIST/friend-requests" "{\"owner\":$FMOM}"; check "she cannot ask someone who doesn't own that list" 404
req mom POST "/api/lists/$FLIST/friend-requests" '{}'; check "… and must say whom" 422
req mom GET "/api/lists/$FLIST"; has "the list now says she asked" '"state":"asked"'
req art GET /api/friends; same "art has one request" ".requests.incoming.length" 1; has "… from mom" '"from":"Moeke"'; has "… sent from his list" '"via":"Voor vrienden"'; FREQ=$(json ".requests.incoming[0].id")
req art GET /api/notices/unseen; same "it counts for the mark in art's header" ".unseen > 0" true
req sis POST "/api/friends/requests/$FREQ/accept"; check "sis cannot answer art's request" 404
req art POST "/api/friends/requests/$FREQ/decline"; check "art declines" 204
req art GET /api/friends; same "it is off art's page" ".requests.incoming.length" 0
req mom GET /api/friends; same "mom still sees it waiting" ".requests.outgoing.length" 1; same "… and they are no friends" ".friends.length" 0
req mom GET /api/notices; lacks "nothing told mom about the decline" "friend_"
req art POST "/api/lists/$MOMLIST/friend-requests" "{\"owner\":$FMOM}"; check "art asks mom after all, from her list" 200; has "… and they are friends at once" '"state":"friends"'
req mom GET /api/friends; same "mom sees her friend's profile picture" ".friends[0].picture" "$ARTPIC"
req mom GET "/api/lists/$FLIST"; lacks "… which no list hands out" "$ARTPIC"
req mom GET /api/friends; same "mom has a friend" ".friends.length" 1; has "… art" '"name":"Art"'; lacks "… without his address" "art@example.test"; same "… and no request left" ".requests.outgoing.length" 0
req art POST /api/friends/links; check "art makes a friend link" 201; FLINK=$(json .token)
preview "/f/$FLINK"; check "a chat app that fetches it gets the login page" 200; has "… which says someone wants to be friends" 'property="og:title" content="Iemand wil vrienden worden op Pakske"'
req art GET "/api/friends/links/$FLINK"; check "it is his own" 200; has "… to send, not to use" '"state":"own"'
req sis GET "/api/friends/links/$FLINK"; check "sis opens it" 200; has "… from art" '"from":"Art"'; has "… and it is open" '"state":"open"'
req sis POST "/api/friends/links/$FLINK/accept"; check "sis accepts" 200
req lot POST "/api/friends/links/$FLINK/accept"; check "the link is spent for lot" 409; has "… with the code invite_closed" invite_closed
req lot GET "/api/friends/links/$UNKNOWN"; check "a friend link nobody made is not found" 404
req mom GET /api/friends; same "being friends shows mom nothing of art's that she hadn't opened herself" ".friends[0].sees.some(l=>l.token==='$UNKNOWN')" false; same "… and what she opened by its link counts as hers to see" ".friends[0].sees.some(l=>l.token==='$FLIST')" true
req mom GET /api/lists; same "… the list she opened is among other people's, as a visited one" ".opened.filter(l=>l.token==='$FLIST').length" 1
req art PUT "/api/friends/$FMOM/lists" "{\"lists\":[\"$FLIST\"]}"; check "art ticks his list for mom" 204
req mom GET /api/friends; same "now art shows it to her, and she has it once" ".friends[0].sees.filter(l=>l.token==='$FLIST').length" 1
req mom GET /api/lists; same "… and it is among other people's lists once, not twice" ".opened.filter(l=>l.token==='$FLIST').length" 1
req mom GET /api/home; same "the home page has it once too" ".opened.filter(l=>l.token==='$FLIST').length" 1
req sis GET "/api/lists/$FLIST/friends"; check "sis cannot see who art shows his list to" 404
req sis PUT "/api/lists/$FLIST/friends" '{"friends":[]}'; check "… or change it" 404
req art GET "/api/lists/$FLIST/friends"; same "art sees his two friends there" ".friends.length" 2; same "… mom ticked" ".friends.find(f=>f.id===$FMOM).shown" true
req art PUT "/api/lists/$FLIST/friends" "{\"friends\":[$LOT_ID]}"; check "art cannot tick lot, who is no friend" 404; has "… with the code not_friends" not_friends
req art PUT "/api/friends/$FMOM/lists" "{\"lists\":[\"$MOMLIST\"]}"; check "… or show mom a list that isn't his" 404
req mom DELETE "/api/home/opened/$FLIST"; check "mom takes the list off her own page" 204
req mom GET /api/lists; same "it is gone there, the visit with it" ".opened.filter(l=>l.token==='$FLIST').length" 0
req art GET "/api/lists/$FLIST/friends"; same "art's tick is as it was" ".friends.find(f=>f.id===$FMOM).shown" true
req art PUT "/api/lists/$FLIST/friends" '{"friends":[]}'; check "art unticks everyone" 204
req art PUT "/api/lists/$FLIST/friends" "{\"friends\":[$FMOM]}"; check "… and ticks mom again" 204
req mom GET /api/lists; same "it is back on mom's page" ".opened.filter(l=>l.token==='$FLIST').length" 1
req mom GET /api/friends; lacks "mom's friends page says nothing of art's other friend" "Zus"
req mom GET "/api/lists/$FLIST"; lacks "… and neither does the list" "Zus"

echo "── sending to a friend"
req art POST "/api/lists/$FLIST/wishes" '{"title":"Kaarsen"}'; check "art adds a wish to send" 201; SENDW=$(json .id)
req art PUT "/api/lists/$FLIST/friends/$FMOM" '{"shown":false}'; check "art switches the list off for mom alone" 204
req art GET "/api/lists/$FLIST/friends"; same "… and it is off for her" ".friends.find(f=>f.id===$FMOM).shown" false
req art PUT "/api/lists/$FLIST/friends/$FMOM" '{"shown":true}'; check "… and on again" 204
req mom GET /api/lists; same "it is on mom's page" ".opened.filter(l=>l.token==='$FLIST').length" 1
req art PUT "/api/lists/$FLIST/friends/$LOT_ID" '{"shown":true}'; check "he cannot switch it on for lot, who is no friend" 404; has "… with the code not_friends" not_friends
req art PUT "/api/lists/$FLIST/friends/$FMOM" '{}'; check "a switch has to say which way" 422
req art PUT "/api/lists/$FLIST/friends/$FMOM" '{"shown":true,"invited":true}'; check "… and only one thing at a time" 422
req sis PUT "/api/lists/$FLIST/friends/$FMOM" '{"shown":true}'; check "sis cannot switch anything on art's list" 404
req art PUT "/api/lists/$FLIST/friends/$FMOM" '{"invited":true}'; check "art invites mom to manage the list" 204
req mom GET /api/notices; has "mom has the invitation" '"kind":"sent_list"'
req art GET "/api/lists/$FLIST/friends"; same "art sees mom among the invited" ".friends.find(f=>f.id===$FMOM).invited" true
req art PUT "/api/lists/$FLIST/friends/$FMOM" '{"invited":false}'; check "an invitation can't be taken back" 422
req mom GET /api/notices; INVNOTE=$(json ".notices.find(n=>n.kind==='sent_list').id"); INVSENT=$(json ".notices.find(n=>n.kind==='sent_list').invite")
req mom POST /api/notices/dismiss "{\"ids\":[\"$INVNOTE\"]}"; check "mom clears her notices" 204
req mom GET /api/notices; has "… which leaves the invitation: only its own cross is her no" '"kind":"sent_list"'
req mom DELETE "/api/notices/$INVNOTE"; check "mom closes it, which is her no" 204
req mom GET "/api/invites/$INVSENT"; check "… and it gives her nothing any more" 404
req art GET "/api/lists/$FLIST/friends"; same "art still sees her among the invited, as if she said nothing" ".friends.find(f=>f.id===$FMOM).invited" true
req art PUT "/api/lists/$FLIST/friends/$FMOM" '{"invited":true}'; check "inviting her again answers as before" 204
req mom GET /api/notices; lacks "… and reaches nobody" sent_list
req art POST "/api/lists/$FLIST/invites" "{\"kind\":\"wishes\",\"mode\":\"linked\",\"wishIds\":[$SENDW],\"friends\":[$FMOM]}"; check "art sends the wish to mom" 201; same "… and hears how many it went to" ".sent" 1; lacks "… without a link to pass on" '"invite"'
req art POST "/api/lists/$FLIST/invites" "{\"kind\":\"wishes\",\"mode\":\"linked\",\"wishIds\":[$SENDW],\"friends\":[$LOT_ID]}"; check "he cannot send it to lot, who is no friend" 404; has "… with the code not_friends" not_friends
req art POST "/api/lists/$FLIST/invites" '{"kind":"list","friends":[]}'; check "sending to nobody is refused" 422
req mom GET /api/notices; has "mom has a notice about it" '"kind":"sent_linked"'; SENT=$(json ".notices.find(n=>n.kind==='sent_linked').invite")
req mom GET /api/notices/unseen; lacks "… and the mark for something new" '"unseen":0'
req sis GET "/api/invites/$SENT"; check "sis cannot open what was sent to mom" 404
req art GET "/api/invites/$SENT"; check "… and neither can art, who sent it" 404
req sis POST "/api/invites/$SENT/accept" '{"newList":"Niet van mij"}'; check "sis cannot take it either" 404
req mom GET "/api/invites/$SENT"; check "mom opens it" 200; has "… and it is open" '"state":"open"'; has "… from art" '"from":"Art"'
req mom POST "/api/invites/$SENT/accept" '{"newList":"Van Art gekregen"}'; check "mom says yes" 200; GOTLIST=$(json .token)
req mom GET /api/notices; lacks "her notice is gone" sent_linked
req mom GET "/api/invites/$SENT"; check "… and so is what was sent" 404
req art GET /api/notices; has "art is told she said yes" '"kind":"share_accepted"'
req mom DELETE "/api/lists/$GOTLIST"; check "mom deletes the list it landed on" 204
req art GET "/api/lists/$FLIST"; same "the list is still art's alone" ".owners.length" 1
req art POST "/api/lists/$FLIST/invites" "{\"kind\":\"wishes\",\"mode\":\"copy\",\"wishIds\":[$SENDW],\"friends\":[$FMOM]}"; check "art sends mom a copy to take" 201
req mom GET /api/notices; has "it waits for her" '"kind":"sent_copy"'

echo "── friends no more"
req art DELETE "/api/friends/$FMOM"; check "art removes mom as a friend" 204
req mom GET /api/lists; same "the list is off her page" ".opened.filter(l=>l.token==='$FLIST').length" 0
req mom GET /api/friends; same "… and art off her friends" ".friends.length" 0
req mom GET /api/notices; lacks "… and what he sent her and she hadn't answered" sent_copy
req art DELETE "/api/friends/$FMOM"; check "removing her again finds no friend" 404; has "… with the code not_friends" not_friends

echo "── Secret Santa"
req anon GET /api/santa; check "the Secret Santa page needs a login" 401
req anon POST /api/santa '{"title":"Kerst","list":null}'; check "… and so does making a group" 401
for who in art mom sis lot; do
  req $who POST /api/lists '{"title":"Voor Secret Santa"}'; SLIST=$(json .token)
  req $who POST "/api/lists/$SLIST/wishes" '{"title":"Iets kleins","quantity":null}'
  eval "SL_$who=$SLIST"
done
req art POST /api/santa "{\"title\":\"\",\"list\":\"$SL_art\"}"; check "a group needs a name" 422; has "… naming the field" '"title":"required"'
req art POST /api/santa "{\"title\":\"Kerst\",\"list\":\"$SL_mom\"}"; check "a group takes no list of someone else's" 404
req art POST /api/santa "{\"title\":\"Kerst\",\"list\":\"$SL_art\"}"; check "art makes a group, with his list in it" 201; SANTA=$(json .token)
req anon GET "/api/santa/$SANTA"; check "a group needs a login to open" 401
preview "/s/$SANTA"; check "a chat app that fetches its link gets the login page" 200; has "… which says it is a Secret Santa" 'property="og:title" content="Je bent uitgenodigd voor een Secret Santa"'; lacks "… and not which" Kerst
preview "/l/$SL_art"; has "the list he put in is passed on with its name and whose it is" 'property="og:title" content="Voor Secret Santa van Art"'; has "… and how many wishes are on it" 'property="og:description" content="Een verlanglijstje met één wens.'
req art GET "/api/santa/$SANTA"; check "art opens it" 200; has "… as a member" '"role":"member"'; has "… who runs it" '"organiser":true'; same "… and is alone in it" ".members.length" 1; same "… with nobody drawn" ".pick" null
req art GET /api/santa; same "it is on his page" ".length" 1; has "… by name" '"title":"Kerst"'
req art GET /api/home; same "… and on his home page" ".santa.length" 1
req mom GET /api/home; same "… and not on mom's" ".santa.length" 0
req mom GET "/api/santa/$SANTA"; check "mom opens the link" 200; has "… as someone who can join" '"role":"guest"'; has "… told who runs it" '"organiser":"Art"'; same "… and how many are in" ".members" 1; lacks "… and no address of his" "art@example.test"
req mom GET "/api/santa/$UNKNOWN"; check "an address no group has is not found" 404
req mom POST "/api/santa/$SANTA/join" '{}'; check "joining says which list, or none" 422
req mom POST "/api/santa/$SANTA/join" "{\"list\":\"$SL_art\"}"; check "… and never someone else's list" 404
req mom POST "/api/santa/$SANTA/join" "{\"list\":\"$SL_mom\"}"; check "mom joins with her list" 204
req art GET /api/notices; has "art is told that mom joined" '"kind":"santa_joined"'; has "… with where the group is" "\"santa\":\"$SANTA\""
# The lists the members put in are shown to every member, without anyone sending a link.
req mom GET "/api/santa/$SANTA"; same "the group has everyone's list beside their name" ".members.map(m=>m.list&&m.list.token).join()" "$SL_art,$SL_mom"
req mom GET /api/lists; same "mom finds art's list among those of others, with the group's name" ".opened.filter(l=>l.token==='$SL_art').map(l=>l.santa.join()).join()" Kerst
req art GET /api/home; same "… and art finds hers on his home page" ".opened.filter(l=>l.token==='$SL_mom').length" 1
req mom GET "/api/lists/$SL_art"; check "she opens it" 200; has "… as someone who doesn't own it" '"viewerOwnsList":false'
req mom DELETE "/api/home/opened/$SL_art"; check "taking it off her page is no error" 204
req mom GET /api/lists; same "… and leaves it there: it goes with the group" ".opened.filter(l=>l.token==='$SL_art').length" 1
req eng GET /api/lists; same "someone outside the group finds none of them" ".opened.filter(l=>l.santa).length" 0
req eng GET "/api/santa/$SANTA"; lacks "… and the group's link names no list" "$SL_art"
req art POST "/api/santa/$SANTA/draw"; check "two people are too few to draw" 409; has "… with the code santa_too_few" santa_too_few
req sis POST "/api/santa/$SANTA/join" '{"list":null}'; check "sis joins without a list" 204
req sis PUT "/api/santa/$SANTA/list" "{\"list\":\"$SL_sis\"}"; check "… and puts one in afterwards" 204
req lot POST "/api/santa/$SANTA/join" "{\"list\":\"$SL_lot\"}"; check "lot joins" 204
req eng POST "/api/santa/$SANTA/join" '{"list":null}'; check "someone who shouldn't be in it joins too" 204
req eng PUT "/api/santa/$SANTA/list" "{\"list\":\"$SL_art\"}"; check "nobody puts in a list that isn't theirs" 404
req art GET "/api/santa/$SANTA"; same "art sees five members" ".members.length" 5; ENGID=$(json ".members.find(m=>m.name==='Eng').id"); MEMBERS=$(json ".members.filter(m=>m.name!=='Eng').map(m=>m.id).sort().join()")
req mom POST "/api/santa/$SANTA/draw"; check "a member who doesn't run the group can't draw" 403
req mom DELETE "/api/santa/$SANTA/members/$ENGID"; check "… or take anyone out" 403
req mom PATCH "/api/santa/$SANTA" '{"title":"Van mom"}'; check "… or rename it" 403
req mom DELETE "/api/santa/$SANTA"; check "… or end it" 403
req art PATCH "/api/santa/$SANTA" '{"title":"Kerst bij oma"}'; check "art renames it" 204
req art DELETE "/api/santa/$SANTA/members/$ENGID"; check "art takes the fifth one out" 204
req eng GET /api/notices; has "who is told so" '"kind":"santa_removed"'; has "… with nowhere to go" '"santa":null'
req eng GET "/api/santa/$SANTA"; has "… and is outside again" '"role":"guest"'
req lot POST "/api/santa/$SANTA/leave"; check "lot leaves" 204
req lot POST "/api/santa/$SANTA/join" "{\"list\":\"$SL_lot\"}"; check "… and joins again with the link" 204
req art POST "/api/santa/$SANTA/draw"; check "art draws the names" 204
req art POST "/api/santa/$SANTA/draw"; check "… once" 409; has "… with the code santa_drawn" santa_drawn
# everyone_drew <who…>: each of them reads the group, finds one name there that isn't their own
# and nothing about anyone else's, and together the names are the members.
everyone_drew() {
  local picks="" who me pick
  for who in "$@"; do
    req $who GET "/api/santa/$SANTA"; check "$who reads the group" 200
    lacks "… with nothing about anyone else's name" givesTo
    me=$(json ".members.find(m=>m.you).id"); pick=$(json .pick.id)
    if [ -n "$pick" ] && [ "$pick" != "$me" ]; then ok "… and drew someone else"; else bad "$who drew \"$pick\", and is $me"; fi
    picks="$picks $pick"
  done
  req art GET "/api/santa/$SANTA"
  if [ "$(echo $picks | tr ' ' '\n' | sort -n | paste -sd, -)" = "$(json ".members.map(m=>m.id).sort((a,b)=>a-b).join()")" ]; then ok "every member was drawn by exactly one"; else bad "the names drawn are$picks"; fi
}
everyone_drew art mom sis lot
req mom GET /api/notices; has "the members are told the names were drawn" '"kind":"santa_drawn"'
req eng GET "/api/santa/$SANTA"; has "someone outside reads that the names are drawn" '"state":"drawn"'; lacks "… and nothing about the members" '"pick"'
req art GET "/api/santa/$SANTA"; MOMID=$(json ".members.find(m=>m.name==='Moeke').id"); PICKLIST=$(json .pick.list.token); PICKNAME=$(json .pick.name)
# What art ticks for the person he drew is without his name, though his account gives with it.
req art GET "/api/lists/$PICKLIST"; check "art opens the list of the person he drew" 200; same "… which says whose name he drew" ".drewOwners.join()" "$PICKNAME"; GIFT=$(json ".wishes[0].id")
req art PUT "/api/lists/$PICKLIST/wishes/$GIFT/purchase" '{"quantity":1}'; check "art ticks a wish there" 204
req eng GET "/api/lists/$PICKLIST"; same "someone else reads no name on it" ".wishes[0].purchases[0].name" null; same "… and nobody's name was drawn by them" ".drewOwners.length" 0
req art PUT "/api/lists/$PICKLIST/wishes/$GIFT/purchase" '{"quantity":1,"anonymous":false}'; check "art can still give it with his name" 204
req eng GET "/api/lists/$PICKLIST"; same "… and then it is there" ".wishes[0].purchases[0].name" Art
req art DELETE "/api/lists/$PICKLIST/wishes/$GIFT/purchase"; check "art takes the tick back" 204
req eng DELETE "/api/home/opened/$PICKLIST"; check "… and the outsider takes the list off their page again" 204
# Someone who joins after the draw has no name until the names are drawn again, for everyone.
req eng POST "/api/santa/$SANTA/join" '{"list":null}'; check "someone joins after the draw" 204
req eng GET "/api/santa/$SANTA"; has "… without a name" '"waits":"late"'; same "… so nobody to buy for yet" ".pick" null
req art GET /api/notices; has "art is told to draw again" '"kind":"santa_joined_late"'
req art GET "/api/santa/$SANTA"; same "art still has the name he drew" ".pick.name" "$PICKNAME"; same "… and sees who waits" ".members.filter(m=>m.waiting).map(m=>m.name).join()" Eng
req eng POST "/api/santa/$SANTA/leave"; check "the latecomer can leave again" 204
req eng POST "/api/santa/$SANTA/join" '{"list":null}'; check "… and come back" 204
req mom POST "/api/santa/$SANTA/draw"; check "only the person who runs the group draws again" 403
req art POST "/api/santa/$SANTA/draw"; check "art draws the names again" 204
everyone_drew art mom sis lot eng
for who in mom sis lot eng; do req $who GET /api/notices; has "$who is told the names were drawn again" '"kind":"santa_redrawn"'; done
req art POST "/api/santa/$SANTA/draw"; check "with a name for everyone the draw stands" 409; has "… with the code santa_drawn" santa_drawn
# Anyone can leave or be taken out, also with a name. The draw then no longer counts for anyone.
req eng POST "/api/santa/$SANTA/leave"; check "someone with a name leaves" 204
req sis GET "/api/santa/$SANTA"; has "the draw no longer counts for those who stay" '"lapsed":true'; has "… who are all without a name" '"waits":"lapsed"'; same "… and none of them marked as the one who waits" ".members.filter(m=>m.waiting).length" 0
for who in art mom sis lot; do req $who GET /api/notices; has "$who is told who went" '"kind":"santa_lapsed"'; done
req sis GET /api/santa; has "the row says the names are to be drawn again" '"again":true'
req art POST "/api/santa/$SANTA/draw"; check "art draws again for the four who stay" 204
everyone_drew art mom sis lot
req art DELETE "/api/santa/$SANTA/members/$MOMID"; check "art takes out someone who has a name" 204
req mom GET /api/notices; has "who is told so" '"kind":"santa_removed"'
req lot GET "/api/santa/$SANTA"; has "the draw no longer counts again" '"lapsed":true'; same "… with three left" ".members.length" 3
req lot GET /api/notices; same "… and the others are told that she went" ".notices.slice(0,1).map(n=>n.kind+' '+n.actor).join()" "santa_lapsed Moeke"
req mom POST "/api/santa/$SANTA/join" "{\"list\":\"$SL_mom\"}"; check "she joins again with the link" 204
req art POST "/api/santa/$SANTA/draw"; check "… and art draws once more" 204
everyone_drew art mom sis lot
status_of "/s/$SANTA"; check "the group's page sends a visitor to log in" 302
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -b "$TMP/art.jar" "$BASE/s/$SANTA"); check "the page opens for a member" 200
if grep -q "gives_to\|givesTo" "$BODY"; then bad "the page as sent names a column of the draw"; else ok "… and holds nothing of the draw but his own name"; fi
req art DELETE "/api/santa/$SANTA"; check "art ends the group" 204
req mom GET "/api/santa/$SANTA"; check "it is gone for mom" 404
req mom GET /api/lists; same "… and the others' lists are off her page" ".opened.filter(l=>l.santa).length" 0
req mom GET /api/notices; lacks "… with what she was told about it" santa_drawn
for who in art mom sis lot; do eval "SLIST=\$SL_$who"; req $who DELETE "/api/lists/$SLIST" '{}'; done; check "the lists made for it are deleted again" 204

echo "── writing to a list's owners"
req art POST /api/lists '{"title":"Vragen"}'; ASK=$(json .token)
req anon POST /api/lists/$ASK/messages '{"body":"Welke maat?"}'; check "writing to the owners needs a login" 401
req anon GET /api/lists/$ASK; lacks "… and a visitor gets no conversations" '"body"'
req mom GET /api/lists/$ASK; check "mom opens the list" 200; has "… with no conversation yet" '"threads":[]'
req mom POST /api/lists/$ASK/messages '{"body":" "}'; check "an empty message is refused" 422; has "… naming the field" '"body":"required"'
req mom POST /api/lists/$ASK/messages '{"body":"Welke maat?"}'; check "mom writes to the owner" 201; ASK_MSG=$(json .id); ASK_THREAD=$(json .thread)
req sis GET /api/lists/$ASK; req sis POST /api/lists/$ASK/messages '{"body":"Heb je al een fiets?"}'; check "sis writes too" 201
req art GET /api/lists/$ASK; has "the owner reads what mom wrote" '"body":"Welke maat?"'; has "… and what sis wrote" '"body":"Heb je al een fiets?"'
lacks "… without mom's name" Moeke; lacks "… or sis's" Zus; lacks "… or an account's id" '"userId"'
same "… as two conversations" '.threads.length' 2
req art GET /api/notices; has "the owner gets a notice that names nobody" '"kind":"list_message","actor":"","actorId":0,"picture":null'
req art POST /api/lists/$ASK/messages '{"body":"Hallo?"}'; check "an owner can't write without a conversation to answer" 403
req art POST /api/lists/$ASK/messages '{"body":"Medium.","thread":"not-an-id"}'; check "a conversation's id has to look like one" 422
req art POST /api/lists/$ASK/messages '{"body":"Medium.","thread":"00000000-0000-4000-8000-000000000000"}'; check "an unknown conversation is not found" 404
req art POST /api/lists/$ASK/messages "{\"body\":\"Medium.\",\"thread\":\"$ASK_THREAD\"}"; check "the owner answers mom" 201
req mom GET /api/lists/$ASK; has "mom reads the answer, with the owner's name" '"owner":"Art"'; same "… in her one conversation" '.threads.length' 1
lacks "… and nothing of what sis wrote" fiets
req mom GET /api/notices; has "mom gets a notice about the answer" '"kind":"message_answered","actor":"Art"'
req sis GET /api/lists/$ASK; lacks "sis reads nothing of mom's conversation" maat
req art DELETE /api/messages/$ASK_MSG; check "the owner can't delete what mom wrote" 404
req sis DELETE /api/messages/$ASK_MSG; check "… and neither can sis" 404
req sis DELETE /api/lists/$ASK/threads/$ASK_THREAD; check "only an owner deletes a conversation" 404
req mom DELETE /api/messages/$ASK_MSG; check "mom deletes her own message" 204
req art GET /api/lists/$ASK; lacks "… and it is gone for the owner" 'Welke maat?'
req art DELETE /api/lists/$ASK/threads/$ASK_THREAD; check "the owner deletes the conversation" 204
req mom GET /api/lists/$ASK; has "… and mom's is gone with it" '"threads":[]'
req art DELETE /api/lists/$ASK '{}'; check "art deletes the list" 204
req mom POST /api/lists/$ASK/messages '{"body":"Nog iets"}'; check "a deleted list takes no message" 404

echo "── a new link"
# On a list of its own, so art's other lists stay as the checks around this expect.
req art POST /api/lists '{"title":"Nieuwjaar"}'; check "art makes a list for it" 201; RELIST=$(json .token)
req art POST "/api/lists/$RELIST/wishes" '{"title":"Kaarsen","quantity":3}'; check "… with a wish asked for three times" 201; CANDLES=$(json .id)
req art POST "/api/lists/$RELIST/wishes" '{"title":"Slingers"}'; check "… and another" 201; GARLAND=$(json .id)
req mom PUT "/api/lists/$RELIST/wishes/$CANDLES/purchase" '{"quantity":2}'; check "mom takes two candles" 204
req lot GET "/api/lists/$RELIST"; check "lot opens it and ticks nothing" 200
req anon POST "/api/lists/$RELIST/new-link"; check "a new link needs a login" 401
req mom POST "/api/lists/$RELIST/new-link"; check "mom cannot give art's list a new link" 404
req art POST "/api/lists/$RELIST/new-link"; check "art gives it one" 200; NEWLIST=$(json .token)
if [ -n "$NEWLIST" ] && [ "$NEWLIST" != "$RELIST" ]; then ok "… which is another address"; else bad "… which is another address: got \"$NEWLIST\""; fi
req anon GET "/api/lists/$NEWLIST"; check "the new address opens for a visitor" 200; has "… with the wishes" '"title":"Kaarsen"'
req anon GET "/api/lists/$RELIST"; check "the old one is nothing for a visitor" 404
req lot GET "/api/lists/$RELIST"; check "… and for lot, who ticked nothing" 404
req lot GET /api/lists; lacks "the list left lot's visited lists" "Nieuwjaar"
req lot DELETE "/api/lists/$RELIST/wishes/$CANDLES/purchase"; check "lot, who ticked nothing, cannot even take nothing back there" 404
req mom DELETE "/api/lists/$RELIST/wishes/$GARLAND/purchase"; check "… nor mom on a wish she never ticked" 404
req art GET "/api/lists/$RELIST"; check "art is told where the list went" 200; has "… with the new address" "\"movedTo\":\"$NEWLIST\""
req art PATCH "/api/lists/$RELIST" '{"title":"Oud"}'; check "art cannot change the list through the old address" 404
req art GET /api/lists; has "art's lists have it at the new address" "$NEWLIST"; lacks "… and not at the old one" "$RELIST"
req mom GET "/api/lists/$RELIST"; check "mom still gets what she ticked, at the old address" 200; has "… marked old" '"old":true'; has "… her candles" '"title":"Kaarsen"'; lacks "… and no other wish" "Slingers"; lacks "… and not the new address" "$NEWLIST"
req mom GET /api/home; lacks "her home page doesn't give the new address away either" "$NEWLIST"; lacks "… and leaves the candles out, on a list she has no link of now" Kaarsen
req mom PUT "/api/lists/$RELIST/wishes/$CANDLES/purchase" '{"quantity":3}'; check "she cannot take more there" 409; has "… because it left that address" wish_removed
req mom PUT "/api/lists/$RELIST/wishes/$GARLAND/purchase" '{"quantity":1}'; check "… or tick another wish" 404
req mom POST "/api/lists/$RELIST/wishes/$CANDLES/notes" '{"body":"x"}'; check "… or write a note" 404
req mom POST "/api/lists/$RELIST/wishes/$CANDLES/copy" "{\"list\":\"$MOMLIST\"}"; check "… or copy the wish" 404
req mom PUT "/api/lists/$RELIST/wishes/$CANDLES/purchase" '{"quantity":1}'; check "she lowers what she ticked" 204
req sis GET "/api/lists/$NEWLIST"; same "sis sees one candle taken, at the new address" ".wishes.find(w=>w.id===$CANDLES).bought" 1
req mom DELETE "/api/lists/$RELIST/wishes/$CANDLES/purchase"; check "mom takes it back" 204
req mom GET "/api/lists/$RELIST"; check "then the old address is nothing to her either" 404
req mom GET /api/lists; lacks "none of that put the list on mom's visited lists" "Nieuwjaar"

echo "── deleting a list"
req art DELETE "/api/lists/$TOKEN"; check "art deletes his list" 204
req art DELETE "/api/lists/$TOKEN"; check "a second delete finds nothing" 404
req art GET "/api/lists/$TOKEN"; check "art no longer gets it" 404
req anon GET "/api/lists/$TOKEN"; check "a visitor no longer gets it" 404
req mom GET "/api/lists/$TOKEN"; check "mom, who bought from it, still gets it" 200; has "… marked as deleted" '"deleted":true'
req mom PUT "/api/lists/$TOKEN/wishes/$PLUGS/purchase" '{"quantity":2}'; check "mom cannot buy more on it" 409; has "… because it was removed" wish_removed
req mom DELETE "/api/lists/$TOKEN/wishes/$PLUGS/purchase"; check "mom can still take back her purchase" 204
req art GET /api/lists; lacks "art's lists no longer have it, own or visited" "$TOKEN"

echo "── a copy of your data"
req anon GET /api/me/export; check "the copy of an account's data needs a login" 401
req mom GET /api/me/export; check "mom downloads hers" 200; has "… with her address" '"email":"mom@example.test"'; has "… and her own list" '"title":"Verlanglijst"'
lacks "… and nobody else's address" "art@example.test"
if curl -s -D - -o /dev/null -b "$TMP/mom.jar" "$BASE/api/me/export" | grep -qi '^content-disposition: attachment; filename="pakske.json"'; then ok "… as a file the browser saves"; else bad "the copy is not sent as a file"; fi

echo "── deleting an account"
register weg Wendy; check "wendy registers" 201
req weg GET /api/me/lists; WEGLIST=$(json ".lists[0].token")
req weg POST "/api/lists/$WEGLIST/wishes" '{"title":"Fiets"}'; check "wendy puts a wish on her first list" 201; BIKE=$(json .id)
req mom PUT "/api/lists/$WEGLIST/wishes/$BIKE/purchase" '{"quantity":1}'; check "mom buys it" 204
req mom POST "/api/lists/$MOMLIST/wishes" '{"title":"Thee"}'; check "mom adds a wish to her own list" 201; TEA=$(json .id)
req weg PATCH /api/me '{"anonymousDefault":true}'; check "wendy gives without her name by default" 200
req weg PUT "/api/lists/$MOMLIST/wishes/$TEA/purchase" '{"quantity":1}'; check "wendy buys mom's tea, saying nothing about her name" 204
req weg POST "/api/lists/$MOMLIST/wishes/$TEA/notes" '{"body":"Ik haal de thee."}'; check "… and writes a note about it" 201
req sis GET "/api/lists/$MOMLIST"; same "sis sees that someone has it" ".wishes.find(w=>w.id===$TEA).bought" 1
same "… and not who" ".wishes.find(w=>w.id===$TEA).purchases[0].name" null
same "… and who wrote the note" ".wishes.find(w=>w.id===$TEA).notes[0].author" Wendy
req anon DELETE /api/me; check "deleting an account needs a login" 401
req weg DELETE /api/me '{"currentPassword":"wrong wrong wrong"}'; check "a wrong password deletes nothing" 403; has "… and is called wrong" wrong_password
req weg DELETE /api/me '{}'; check "… and neither does leaving it out" 403
req weg GET /api/me; check "wendy is still there" 200
req weg DELETE /api/me '{"currentPassword":"correct horse battery"}'; check "with her password, wendy deletes her account" 204
req weg GET /api/me; check "her login went with it" 401
login weg2 weg; check "… and nobody logs into it again" 401
# Her list goes with her, as if she had deleted it herself.
req anon GET "/api/lists/$WEGLIST"; check "a visitor no longer gets her list" 404
req sis GET "/api/lists/$WEGLIST"; check "sis, who bought nothing from it, is told it was deleted" 200; has "… and that is all" '"deleted":true'; same "… with none of its wishes" ".wishes.length" 0
req mom GET "/api/lists/$WEGLIST"; check "mom, who bought from it, still gets it" 200; has "… marked as deleted" '"deleted":true'; has "… with nobody's name on it" '"owners":[]'
same "… with what she bought" ".wishes.find(w=>w.id===$BIKE).mine" 1
req mom PATCH "/api/lists/$WEGLIST" '{"title":"Van mij"}'; check "nobody can rename it" 404
req mom PATCH "/api/lists/$WEGLIST/wishes/$BIKE" '{"title":"Step"}'; check "… or change a wish on it" 404
req mom DELETE "/api/lists/$WEGLIST/wishes/$BIKE/purchase"; check "mom can take back what she bought" 204
# What she ticked goes, and what she wrote stays without her name.
req sis GET "/api/lists/$MOMLIST"; same "what wendy was getting from mom's list is free again" ".wishes.find(w=>w.id===$TEA).bought" 0
same "… and her note is still there" ".wishes.find(w=>w.id===$TEA).notes[0].body" "Ik haal de thee."
same "… written by nobody" ".wishes.find(w=>w.id===$TEA).notes[0].author" null
req mom GET "/api/lists/$MOMLIST"; same "… and mom's own page says what it said" ".wishes.find(w=>w.id===$TEA).mine" 0
# An account made again with the same address has nothing to do with the old one.
register weg Wendy; check "wendy registers again with the same address" 201
req weg GET /api/me/lists; lacks "her old list is not among her lists" "$WEGLIST"; same "… she starts with one list" ".lists.length" 1
req weg GET "/api/lists/$WEGLIST"; check "she opens the old one like anyone else" 200; has "… as a deleted list that isn't hers" '"viewerOwnsList":false'; same "… with none of its wishes" ".wishes.length" 0
req weg GET "/api/lists/$MOMLIST"; same "her old note is not hers" ".wishes.find(w=>w.id===$TEA).notes[0].mine" false
same "… and what she ticked is not back" ".wishes.find(w=>w.id===$TEA).mine" 0

echo "── links in mails"
req anon GET "/api/auth/mail-link?code=made-up"; check "a made-up code from a mail is read without an error" 200; has "… as a link that doesn't work" '"link":null'
req anon GET /api/auth/mail-link; check "… and so is no code at all" 200; has "… with the same answer" '"link":null'
req anon POST /api/auth/mail-link '{"code":"made-up","newPassword":"correct horse battery"}'; check "using a made-up code changes nothing" 410; has "… with the code link_gone" link_gone
req anon POST /api/auth/mail-link '{"newPassword":"correct horse battery"}'; check "… and a code is needed" 422
req anon POST /api/auth/mail-link '{"code":"made-up","newPassword":"short"}'; check "… and a new password of 8 characters" 422; has "… naming the field" '"newPassword":"password_short"'
status_of /auth/action; check "the page behind a mail's link opens without a code" 200; has "… and says the link doesn't work" 'Deze link werkt niet meer'
status_of "/auth/action?mode=resetPassword&oobCode=made-up&lang=en"; check "a link from a mail in English goes on to the English page" 302
status_of "/en/auth/action?mode=resetPassword&oobCode=made-up&lang=en"; check "… which opens" 200; has "… and says the same in English" 'This link no longer works'

echo "── guard rails"
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X POST -b "$TMP/mom.jar" -H 'Origin: https://evil.example' -H 'Content-Type: application/json' --data '{"title":"x"}' "$BASE/api/lists"); check "a request from another site is refused" 403
head -c 20000 /dev/zero | tr '\0' 'a' > "$TMP/long"
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X POST -b "$TMP/mom.jar" -H 'Content-Type: application/json' --data "{\"title\":\"$(cat "$TMP/long")\"}" "$BASE/api/lists"); check "a 20 KB body is refused" 413
for i in 1 2 3 4 5; do req anon POST /api/auth/login '{"email":"sis@example.test","password":"wrong wrong wrong"}'; done
login anon sis; check "after five wrong passwords the account is locked for a while" 429
login anon2 mom; check "another account can still log in" 200

# The privacy page says the login cookie starts at the login.
if jar_has anon nuxt-auth-session; then bad "a visitor who never logged in got a login cookie"; else ok "a visitor who never logged in has no login cookie"; fi

rm -rf "$TMP"
if [ "$FAILED" = 0 ]; then echo; echo "All checks passed."; else echo; echo "Some checks FAILED."; fi
exit $FAILED
