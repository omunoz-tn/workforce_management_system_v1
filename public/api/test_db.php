<?php
// Simple test script to check database connection and table
header('Content-Type: application/json');
error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once 'db_wfm_config.php';

$response = [];

try {
    // Check if connection is alive (already established in db_wfm_config.php)
    $response['connection'] = 'OK';

    // Check if database exists
    $stmt = $pdo->query("SHOW DATABASES LIKE 'wfm_platform'");
    if ($stmt->rowCount() > 0) {
        $response['database'] = 'EXISTS';

        // Select database
        $pdo->exec("USE wfm_platform");

        // Check if table exists
        $stmt = $pdo->query("SHOW TABLES LIKE 'desktime_employee_data'");
        if ($stmt->rowCount() > 0) {
            $response['table'] = 'EXISTS';

            // Get row count
            $stmt = $pdo->query("SELECT COUNT(*) FROM desktime_employee_data");
            $response['row_count'] = $stmt->fetchColumn();

            // Get columns
            $stmt = $pdo->query("DESCRIBE desktime_employee_data");
            $response['columns'] = $stmt->fetchAll(PDO::FETCH_COLUMN);
        } else {
            $response['table'] = 'NOT_FOUND';
        }
    } else {
        $response['database'] = 'NOT_FOUND';
    }

} catch (PDOException $e) {
    $response['error'] = $e->getMessage();
}

echo json_encode($response, JSON_PRETTY_PRINT);
?>