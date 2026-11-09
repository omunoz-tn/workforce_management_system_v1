<?php
/**
 * Migration Script: Create org_employee_daylight_saving table
 *
 * One row per employee with Employees > Teams > Assign Members > Daylight Saving on. Their
 * schedules set in this system move one hour with the US clock changes (DaylightSaving.php).
 *
 * The reports also create it on first use (WorkScheduleSql.php), so running this is
 * optional; it is here so the table can be created ahead of a deploy.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'DaylightSaving.php';

try {
    ensureEmployeeDaylightSavingTable($pdo);
    echo json_encode([
        'success' => true,
        'message' => 'org_employee_daylight_saving table ready.'
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
