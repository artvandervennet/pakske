CREATE TABLE `friend_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`from_user` integer NOT NULL,
	`to_user` integer NOT NULL,
	`list_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`seen_at` integer,
	FOREIGN KEY (`from_user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_requests_pair_idx` ON `friend_requests` (`from_user`,`to_user`);--> statement-breakpoint
CREATE INDEX `friend_requests_to_idx` ON `friend_requests` (`to_user`);--> statement-breakpoint
CREATE TABLE `friendships` (
	`user_low` integer NOT NULL,
	`user_high` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_low`, `user_high`),
	FOREIGN KEY (`user_low`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_high`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "friendships_order_check" CHECK("friendships"."user_low" < "friendships"."user_high")
);
--> statement-breakpoint
CREATE INDEX `friendships_high_idx` ON `friendships` (`user_high`);