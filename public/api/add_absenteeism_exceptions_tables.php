<?php
/**
 * Migration Script: Create the three Absenteeism Report exception tables
 * (org_absenteeism_excluded_days, org_absenteeism_excluded_employees,
 * org_absenteeism_excluded_employee_days).
 *
 * The DDL lives in AbsenteeismExceptionsSql.php so the report can self-heal a
 * missing table; this file is the explicit entry point for running it.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'AbsenteeismExceptionsSql.php';

try {
    ensureAbsenteeismExceptionTables($pdo);

    echo json_encode([
        'success' => true,
        'message' => 'Absenteeism exception tables ready.'
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
