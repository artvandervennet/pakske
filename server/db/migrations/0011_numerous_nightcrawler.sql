CREATE TABLE `friend_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_links_token_unique` ON `friend_links` (`token`);--> statement-breakpoint
CREATE INDEX `friend_links_maker_idx` ON `friend_links` (`created_by`);