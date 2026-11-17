CREATE TABLE `invite_wishes` (
	`invite_id` integer NOT NULL,
	`wish_id` integer NOT NULL,
	PRIMARY KEY(`invite_id`, `wish_id`),
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wish_id`) REFERENCES `wishes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`kind` text NOT NULL,
	`list_id` integer NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);--> statement-breakpoint
CREATE TABLE `link_changes` (
	`link_id` integer NOT NULL,
	`field` text NOT NULL,
	`before` text NOT NULL,
	PRIMARY KEY(`link_id`, `field`),
	FOREIGN KEY (`link_id`) REFERENCES `wish_links`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` integer NOT NULL,
	`title` text NOT NULL,
	`more` integer DEFAULT 0 NOT NULL,
	`wish_id` integer,
	`list_id` integer,
	`created_at` integer NOT NULL,
	`seen_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wish_id`) REFERENCES `wishes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notices_user_idx` ON `notices` (`user_id`);--> statement-breakpoint
CREATE TABLE `wish_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wish_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`wish_id`) REFERENCES `wishes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wish_links_wish_user_idx` ON `wish_links` (`wish_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `list_wishes` ADD `join_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `list_wishes` ADD `removed_at` integer;