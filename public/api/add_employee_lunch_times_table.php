<?php
/**
 * Migration Script: Create org_employee_lunch_times table
 *
 * Per-employee, per-weekday lunch override (Employees > Teams > Assign Members >
 * Lunch Time > Employee Lunch Time). org_teams.lunch_time stays the team-wide default;
 * a row here exists only for the weekdays one employee disagrees with it, so an employee
 * on the team default keeps following later changes to that default.
 *
 *   effective lunch = COALESCE(org_employee_lunch_times.lunch_time, org_teams.lunch_time, 0)
 *
 * `weekday` is ISO: 1 = Monday ... 7 = Sunday, matching the keys of
 * org_shift_schedule_patterns.pattern. MySQL's WEEKDAY() is 0-based on Monday, so the
 * queries join on WEEKDAY(log_date) + 1.
 *
 * Keyed on employee_id alone, not (team_id, employee_id): the rest of the app resolves an
 * employee's lunch through whichever team they are assigned to, and an employee who sits
 * in two teams would otherwise get two conflicting answers for the same day.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_employee_lunch_times` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          `employee_id` int(11) NOT NULL,
          `weekday` tinyint(4) NOT NULL COMMENT '1=Monday ... 7=Sunday (ISO)',
          `lunch_time` int(11) NOT NULL COMMENT 'minutes',
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          PRIMARY KEY (`id`),
          UNIQUE KEY `unique_employee_weekday` (`employee_id`,`weekday`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    echo json_encode([
        'success' => true,
        'message' => 'org_employee_lunch_times table ready.'
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
