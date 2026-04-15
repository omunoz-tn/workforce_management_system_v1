<?php
require_once 'db_wfm_config.php';
header('Content-Type: application/json');

try {
    $count = $pdo->query("SELECT COUNT(*) FROM org_audit_log")->fetchColumn();
    $latest = $pdo->query("SELECT * FROM org_audit_log ORDER BY id DESC LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode(['total' => $count, 'latest' => $latest], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
?>
