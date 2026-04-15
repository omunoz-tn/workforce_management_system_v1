<?php
require_once 'db_wfm_config.php';

$type = $_GET['type'] ?? '';
$id = $_GET['id'] ?? '';

try {
    $stmt = $pdo->prepare("SELECT * FROM org_audit_log WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT 50");
    $stmt->execute([$type, $id]);
    $history = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode(['success' => true, 'data' => $history]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>