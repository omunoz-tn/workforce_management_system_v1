<?php
/**
 * Migration Script: Run Rate "Time Exceptions"
 *
 * Minutes discounted from the START of the working window before Run Rate is
 * computed — e.g. a 08:15-17:00 shift with a 15 minute Time Exception is billed
 * as 08:30-17:00, and whatever DeskTime tracked between 08:15 and 08:30 is
 * dropped from the actual hours too.
 *
 * Two levels, matching the other Run Rate exceptions:
 *   org_teams.run_rate_time_exception_minutes  - the team's base value
 *   org_run_rate_time_exceptions               - per-employee override; a row
 *                                                absent means "inherit the team"
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $messages = [];

    $check = $pdo->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'org_teams'
        AND COLUMN_NAME = 'run_rate_time_exception_minutes'");
    $check->execute();

    if ((int) $check->fetchColumn() > 0) {
        $messages[] = "Column 'run_rate_time_exception_minutes' already exists on 'org_teams'. No changes made.";
    } else {
        $pdo->exec("ALTER TABLE org_teams
            ADD COLUMN run_rate_time_exception_minutes INT(11) NOT NULL DEFAULT 0
            AFTER exclude_lunch_from_run_rate");
        $messages[] = "Column 'run_rate_time_exception_minutes' added to 'org_teams' (default 0 / no exception).";
    }

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_run_rate_time_exceptions` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          `employee_id` bigint(20) NOT NULL,
          `exception_minutes` int(11) NOT NULL DEFAULT 0,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          PRIMARY KEY (`id`),
          UNIQUE KEY `unique_employee` (`employee_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");
    $messages[] = "org_run_rate_time_exceptions table ready.";

    echo json_encode([
        'success' => true,
        'message' => implode(' ', $messages)
    ], JSON_PRETTY_PRINT);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
