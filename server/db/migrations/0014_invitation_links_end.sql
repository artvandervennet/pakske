-- An invitation to a list worked once and had no end. It now works for everyone who opens it,
-- so every one that is still unused gets the end a new one has: 7 days after it was made.
UPDATE `invites` SET `expires_at` = `created_at` + 604800000
WHERE `kind` = 'list' AND `sent_to` IS NULL AND `used_at` IS NULL AND `expires_at` IS NULL;
