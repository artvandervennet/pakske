CREATE TABLE `santa_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`drawn_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `santa_groups_token_unique` ON `santa_groups` (`token`);--> statement-breakpoint
CREATE TABLE `santa_members` (
	`group_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`list_id` integer,
	`gives_to` integer,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `santa_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`gives_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `santa_members_user_idx` ON `santa_members` (`user_id`);--> statement-breakpoint
-- drizzle-kit leaves the "on delete" out of a reference it adds with a column. Without it a
-- group that still has a notice about it could not be deleted.
ALTER TABLE `notices` ADD `santa_group_id` integer REFERENCES santa_groups(id) ON DELETE cascade;