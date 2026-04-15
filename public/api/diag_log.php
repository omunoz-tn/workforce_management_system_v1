<?php
require_once 'db_wfm_config.php';
header('Content-Type: application/json');

function log_audit($pdo, $type, $id, $action, $details)
{
    $stmt = $pdo->prepare("INSERT INTO org_audit_log (target_type, target_id, action, details) VALUES (?, ?, ?, ?)");
    return $stmt->execute([$type, $id, $action, $details]);
}

try {
    $res = log_audit($pdo, 'group', 1, 'update', 'DIAGNOSTIC TEST LOG ' . date('Y-m-d H:i:s'));
    echo json_encode(['success' => $res]);
} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
?>
