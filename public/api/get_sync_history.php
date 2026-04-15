<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    // Fetch last 30 sync attempts
    $sql = "SELECT * FROM desktime_sync_log ORDER BY created_at DESC LIMIT 30";
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
