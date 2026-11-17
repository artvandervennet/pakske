ALTER TABLE `list_wishes` ADD `position` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Every list keeps the order it had: the order its wishes were made in.
UPDATE `list_wishes` SET `position` = (
  SELECT COUNT(*) FROM `list_wishes` AS `o`
  INNER JOIN `wishes` AS `ow` ON `ow`.`id` = `o`.`wish_id`
  INNER JOIN `wishes` AS `w` ON `w`.`id` = `list_wishes`.`wish_id`
  WHERE `o`.`list_id` = `list_wishes`.`list_id`
    AND (`ow`.`created_at` < `w`.`created_at` OR (`ow`.`created_at` = `w`.`created_at` AND `ow`.`id` < `w`.`id`))
);
