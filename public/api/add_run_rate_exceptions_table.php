<?php
/**
 * Migration Script: Create org_run_rate_excluded_employees table
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_run_rate_excluded_employees` (
          `employee_id` int(11) NOT NULL,
          `excluded_at` timestamp NULL DEFAULT current_timestamp(),
          PRIMARY KEY (`employee_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    echo json_encode([
        'success' => true,
        'message' => 'org_run_rate_excluded_employees table ready.'
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
