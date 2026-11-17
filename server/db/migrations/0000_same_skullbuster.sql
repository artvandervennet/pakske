CREATE TABLE `list_owners` (
	`list_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`list_id`, `user_id`),
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `list_owners_user_idx` ON `list_owners` (`user_id`);--> statement-breakpoint
CREATE TABLE `list_visits` (
	`user_id` integer NOT NULL,
	`list_id` integer NOT NULL,
	`opened_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `list_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `list_wishes` (
	`list_id` integer NOT NULL,
	`wish_id` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`list_id`, `wish_id`),
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wish_id`) REFERENCES `wishes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `list_wishes_wish_idx` ON `list_wishes` (`wish_id`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lists_token_unique` ON `lists` (`token`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`wish_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`wish_id`) REFERENCES `wishes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notes_wish_idx` ON `notes` (`wish_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wish_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`wish_id`) REFERENCES `wishes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "purchases_quantity_check" CHECK("purchases"."quantity" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_wish_user_idx` ON `purchases` (`wish_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `wish_owners` (
	`wish_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`wish_id`, `user_id`),
	FOREIGN KEY (`wish_id`) REFERENCES `wishes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wish_owners_user_idx` ON `wish_owners` (`user_id`);--> statement-breakpoint
CREATE TABLE `wishes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`url` text,
	`image_file` text,
	`quantity` integer DEFAULT 1,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "wishes_quantity_check" CHECK("wishes"."quantity" IS NULL OR "wishes"."quantity" >= 1)
);
