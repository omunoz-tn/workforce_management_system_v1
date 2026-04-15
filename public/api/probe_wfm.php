<?php
// Turn on error reporting
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

require_once 'db_wfm_config.php';

$logFile = __DIR__ . '/debug_log.txt';
file_put_contents($logFile, "Starting probe...\n", FILE_APPEND);

try {
    // List tables
    $stmt = $pdo->query("SHOW TABLES");
    $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);
    file_put_contents($logFile, "Tables: " . json_encode($tables) . "\n", FILE_APPEND);

    if (in_array('desktime_employee_data', $tables)) {
        // Get columns
        $stmt = $pdo->query("DESCRIBE desktime_employee_data");
        $columns = $stmt->fetchAll(PDO::FETCH_COLUMN);
        file_put_contents($logFile, "Columns: " . json_encode($columns) . "\n", FILE_APPEND);
        echo json_encode(['columns' => $columns]);
    } else {
        $msg = "Table 'desktime_employee_data' not found. Available tables: " . implode(', ', $tables);
        file_put_contents($logFile, "Error: $msg\n", FILE_APPEND);
        echo json_encode(['error' => $msg]);
    }

} catch (Exception $e) {
    file_put_contents($logFile, "Exception: " . $e->getMessage() . "\n", FILE_APPEND);
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>