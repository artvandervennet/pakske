#!/usr/bin/env node
// Gives an account a new, random password and prints it. For when someone forgot theirs:
// the site sends no email, so whoever runs the server does this by hand.
//
//   docker compose exec wishlist node scripts/reset-password.mjs mom@example.com
//
// Outside Docker: NUXT_DATA_DIR=.data node scripts/reset-password.mjs mom@example.com
//
// The person logs in with the printed password and picks their own under Settings.
// Uses only Node's built-ins, so it runs in the production image as it is.
import { randomBytes, scryptSync } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const email = process.argv[2]?.trim().toLowerCase()
if (!email) {
  console.error('Usage: node scripts/reset-password.mjs <email>')
  process.exit(1)
}

// The format nuxt-auth-utils writes and reads: scrypt in PHC notation, base64 without padding.
function hashPassword(password) {
  const params = { n: 16384, r: 8, p: 1 }
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64, {
    cost: params.n,
    blockSize: params.r,
    parallelization: params.p,
    maxmem: 32 * 1024 * 1024,
  })
  const b64 = buffer => buffer.toString('base64').replace(/=+$/, '')
  return `$scrypt$n=${params.n},r=${params.r},p=${params.p}$${b64(salt)}$${b64(hash)}`
}

// Four groups of four, from letters and digits that are hard to mix up.
function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const pick = () => alphabet[randomBytes(1)[0] % alphabet.length]
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, pick).join('')).join('-')
}

const file = join(process.env.NUXT_DATA_DIR ?? '.data', 'wishlist.db')
const db = new DatabaseSync(file)
db.exec('PRAGMA busy_timeout = 5000')

const password = randomPassword()
const result = db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashPassword(password), email)
db.close()

if (result.changes === 0) {
  console.error(`No account with the email address ${email} in ${file}.`)
  process.exit(1)
}
console.log(`New password for ${email}: ${password}`)
