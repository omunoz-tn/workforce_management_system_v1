<?php
/**
 * Migration Script: Create org_shift_schedule_patterns + the shift-management menu permission
 *
 * A versioned weekly shift pattern per employee (Scheduling > Shift Management). Unlike
 * org_schedule_forecast_overrides — which keeps a single live row per employee (UNIQUE on
 * employee_id) and is written by Configuration > Scheduling > Forecast — this table keeps
 * one row per version, so superseded schedules stay on record instead of being overwritten.
 *
 * The pattern is resolved at read time in get_schedule_board.php, exactly like the forecast
 * override; nothing is materialised per date. `effective_end` is the last day the version
 * applies (the screen's "Apply Until").
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_shift_schedule_patterns` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          `employee_id` int(11) NOT NULL,
          `employee_name` varchar(255) NOT NULL,
          `effective_start` date NOT NULL,
          `effective_end` date NOT NULL,
          -- {\"1\".. \"7\": \"HH:MM:SS|HH:MM:SS\" | \"OFF\"}, ISO weekday 1=Mon .. 7=Sun.
          `pattern` text NOT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`id`),
          -- Deliberately NOT unique on employee_id: several versions coexist and the one
          -- covering a given date wins. Indexed for the per-date lookup on the board.
          KEY `employee_effective` (`employee_id`,`effective_start`,`effective_end`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    // New menu items are granted to Admin automatically; other roles are assigned by hand
    // in Configuration > User > Roles.
    $granted = false;
    $stmt = $pdo->query("SELECT id FROM platform_roles WHERE name = 'Admin'");
    $adminRoleId = $stmt->fetchColumn();
    if ($adminRoleId) {
        $insert = $pdo->prepare("INSERT IGNORE INTO platform_permissions (role_id, menu_item_id) VALUES (?, ?)");
        $insert->execute([$adminRoleId, 'shift-management']);
        $granted = $insert->rowCount() > 0;
    }

    echo json_encode([
        'success' => true,
        'message' => 'org_shift_schedule_patterns table ready.',
        'admin_permission_granted' => $granted,
        'admin_role_found' => (bool) $adminRoleId
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
