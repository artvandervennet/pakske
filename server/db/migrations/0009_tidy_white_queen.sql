CREATE TABLE `list_old_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`list_id` integer NOT NULL,
	`replaced_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `list_old_tokens_list_idx` ON `list_old_tokens` (`list_id`);