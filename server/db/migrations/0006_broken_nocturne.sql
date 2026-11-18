CREATE TABLE `invite_uses` (
	`invite_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`used_at` integer NOT NULL,
	PRIMARY KEY(`invite_id`, `user_id`),
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `invites` ADD `mode` text DEFAULT 'linked' NOT NULL;--> statement-breakpoint
ALTER TABLE `invites` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `anonymous_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `wishes` ADD `urls` text;--> statement-breakpoint
ALTER TABLE `wishes` ADD `image_from_link` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Everyone starts with one list. An account from before that rule that never owned a list gets
-- one now, with a token like the ones the server makes: 22 characters nobody can guess.
CREATE TEMP TABLE `first_lists` AS
	SELECT `id` AS `user_id`, substr(lower(hex(randomblob(11))), 1, 22) AS `token`
	FROM `users` WHERE `id` NOT IN (SELECT `user_id` FROM `list_owners`);
--> statement-breakpoint
INSERT INTO `lists` (`token`, `title`, `created_at`)
	SELECT `token`, 'Verlanglijst', strftime('%s', 'now') * 1000 FROM `first_lists`;
--> statement-breakpoint
INSERT INTO `list_owners` (`list_id`, `user_id`, `added_at`)
	SELECT `lists`.`id`, `first_lists`.`user_id`, strftime('%s', 'now') * 1000
	FROM `first_lists` JOIN `lists` ON `lists`.`token` = `first_lists`.`token`;
--> statement-breakpoint
DROP TABLE `first_lists`;
