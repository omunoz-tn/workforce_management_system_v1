<?php
/**
 * Migration Script: Create org_team_holiday_types table
 *
 * Per-team override of a holiday's type. Rows are stored ONLY when a team's choice
 * differs from org_holidays.holiday_type, which stays the organization-wide default.
 * A team with no row for a holiday inherits that default, so newly created holidays
 * apply everywhere without having to fan out a row per team.
 *
 * Effective type for a team = COALESCE(org_team_holiday_types.holiday_type,
 *                                      org_holidays.holiday_type)
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_team_holiday_types` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          `team_id` int(11) NOT NULL,
          `holiday_id` int(11) NOT NULL,
          `holiday_type` enum('non_working','working','campaign_defined') NOT NULL,
          -- Custom type only (enum value `campaign_defined`): discounted from the team's
          -- SCHEDULED hours that day; tracked hours are untouched. NULL means no window.
          `exclude_from` time DEFAULT NULL,
          `exclude_to` time DEFAULT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`id`),
          UNIQUE KEY `unique_team_holiday` (`team_id`,`holiday_id`),
          KEY `holiday_id` (`holiday_id`),
          CONSTRAINT `org_team_holiday_types_ibfk_1` FOREIGN KEY (`team_id`)
            REFERENCES `org_teams` (`id`) ON DELETE CASCADE,
          CONSTRAINT `org_team_holiday_types_ibfk_2` FOREIGN KEY (`holiday_id`)
            REFERENCES `org_holidays` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    echo json_encode([
        'success' => true,
        'message' => 'org_team_holiday_types table ready.'
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
