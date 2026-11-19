ALTER TABLE `invites` ADD `sent_to` integer REFERENCES users(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `invites_sent_to_idx` ON `invites` (`sent_to`);--> statement-breakpoint
ALTER TABLE `notices` ADD `invite_id` integer REFERENCES invites(id) ON DELETE cascade;