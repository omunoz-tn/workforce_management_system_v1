<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    // The weekly hours job writes seven rows in one go, so a 30-row window could be filled
    // almost entirely by a single Tuesday run and push the daily history out of sight.
    $sql = "SELECT * FROM desktime_sync_log ORDER BY created_at DESC LIMIT 60";
    $stmt = $pdo->query($sql);
    $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $logs
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
