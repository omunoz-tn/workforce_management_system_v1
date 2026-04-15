<?php
require_once 'db_wfm_config.php';
header('Content-Type: application/json');

try {
    $stmt = $pdo->query("SELECT * FROM org_audit_log ORDER BY id DESC LIMIT 20");
    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode($data, JSON_PRETTY_PRINT);
} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
?>
