-- A wish had one link and now has a list of them. The link it had becomes the first of its list,
-- before the old column goes.
UPDATE `wishes` SET `urls` = json_array(`url`) WHERE `url` IS NOT NULL;
--> statement-breakpoint
-- What an undo remembers follows: the link a wish had before a linker changed it becomes the list
-- it had, so `null` turns into `[]` and `"x"` into `["x"]`. A link remembers a field once (the
-- key is link and field), so a row that already says `urls` makes way for the one from `url`.
UPDATE OR REPLACE `link_changes`
	SET `field` = 'urls', `before` = CASE WHEN `before` = 'null' THEN '[]' ELSE json_array(json(`before`)) END
	WHERE `field` = 'url';
--> statement-breakpoint
ALTER TABLE `wishes` DROP COLUMN `url`;
