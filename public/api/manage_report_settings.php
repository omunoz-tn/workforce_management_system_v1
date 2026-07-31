<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    try {
        $stmt = $pdo->query("SELECT
                ot.id,
                ot.name,
                ot.run_rate_time_source,
                og.name as group_name
            FROM org_teams ot
            LEFT JOIN org_groups og ON ot.group_id = og.id
            ORDER BY og.name ASC, ot.name ASC");
        $teams = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(['success' => true, 'teams' => $teams]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $updates = $data['updates'] ?? [];
    $validSources = ['desktime_time', 'at_work_time'];

    try {
        $pdo->beginTransaction();

        $stmt = $pdo->prepare("SELECT name, run_rate_time_source FROM org_teams WHERE id = ?");
        $update = $pdo->prepare("UPDATE org_teams SET run_rate_time_source = ? WHERE id = ?");

        foreach ($updates as $u) {
            $teamId = $u['team_id'] ?? null;
            $source = $u['run_rate_time_source'] ?? null;

            if (!$teamId || !in_array($source, $validSources, true)) {
                continue;
            }

            $stmt->execute([$teamId]);
            $team = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$team || $team['run_rate_time_source'] === $source) {
                continue;
            }

            $update->execute([$source, $teamId]);
            log_audit($pdo, 'team', $teamId, 'report_config',
                "Run Rate time source for '{$team['name']}' changed from '{$team['run_rate_time_source']}' to '$source'");
        }

        $pdo->commit();
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);

function log_audit($pdo, $type, $id, $action, $details)
{
    $stmt = $pdo->prepare("INSERT INTO org_audit_log (target_type, target_id, action, details) VALUES (?, ?, ?, ?)");
    $stmt->execute([$type, $id, $action, $details]);
}
?>
