CREATE TABLE `list_friends` (
	`list_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`shown_by` integer NOT NULL,
	`added_at` integer NOT NULL,
	`hidden_at` integer,
	PRIMARY KEY(`list_id`, `user_id`, `shown_by`),
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shown_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `list_friends_user_idx` ON `list_friends` (`user_id`);