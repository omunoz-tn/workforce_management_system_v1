<?php
/**
 * sync_desktime.php
 * Synchronizes local database with live data from DeskTime API.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'sync_desktime_core.php';

// Disable error output for clean JSON
ini_set('display_errors', 0);
error_reporting(0);

try {
    $results = syncDeskTime($pdo, $env);
    echo json_encode($results);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>