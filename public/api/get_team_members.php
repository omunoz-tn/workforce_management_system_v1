<?php
require_once 'db_wfm_config.php';

$teamId = $_GET['team_id'] ?? null;

try {
    if (!$teamId)
        throw new Exception("Team ID required");

    $stmt = $pdo->prepare("SELECT employee_id FROM org_team_assignments WHERE team_id = ?");
    $stmt->execute([$teamId]);
    $memberIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

    echo json_encode(['success' => true, 'data' => $memberIds]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>