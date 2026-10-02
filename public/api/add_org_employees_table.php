<?php
/**
 * Migration Script: create org_employees (the employee master record) and fill it from the
 * history already in desktime_employee_data.
 *
 * Idempotent, and safe to re-run to pick up employees synced since the last run: the
 * backfill upserts, so existing rows are refreshed rather than duplicated and the
 * employment window can only widen. See EmployeeRoster.php for why the table exists.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'EmployeeRoster.php';

try {
    $existed = (int) $pdo->query("SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_employees'")->fetchColumn() > 0;

    // Creates the table, and backfills it only when it is empty.
    ensureOrgEmployeesTable($pdo);

    // Re-run explicitly for an existing table, so a second run catches up anyone added
    // since the first.
    if ($existed) {
        backfillOrgEmployees($pdo);
    }

    $stats = $pdo->query("SELECT COUNT(*) AS employees,
                                 MIN(first_seen) AS earliest,
                                 MAX(last_seen) AS latest
                          FROM org_employees")->fetch(PDO::FETCH_ASSOC);

    $current = (int) $pdo->query("SELECT COUNT(*) FROM org_employees oe
                                  WHERE " . orgEmployeeCurrentFilter())->fetchColumn();

    echo json_encode([
        'success' => true,
        'message' => $existed
            ? "org_employees already existed; backfill re-run."
            : "org_employees created and backfilled from desktime_employee_data.",
        'employees' => (int) $stats['employees'],
        'current' => $current,
        'former' => (int) $stats['employees'] - $current,
        'earliest_first_seen' => $stats['earliest'],
        'latest_last_seen' => $stats['latest']
    ], JSON_PRETTY_PRINT);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()], JSON_PRETTY_PRINT);
}
