<?php
/**
 * manage_run_rate_excluded_days.php
 * Calendar days excluded from a specific team's Run Rate calculation
 * (Configuration > Reports > Advance Configuration > Run Rate Report > Days
 * Exceptions). Filtered out in get_dashboard_stats.php's MTD query and
 * get_daily_run_rate.php, per (team_id, log_date) — so the day's hours never
 * contribute to that team's Run Rate, without affecting other teams.
 *
 * POST replaces the full excluded-day set for the given team_id in one shot
 * (mirrors manage_run_rate_exceptions.php's per-team replace pattern).
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $teamId = isset($_GET['team_id']) ? (int) $_GET['team_id'] : null;

    if (!$teamId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'team_id is required']);
        exit;
    }

    try {
        $stmt = $pdo->prepare("SELECT excluded_date FROM org_run_rate_excluded_days WHERE team_id = ? ORDER BY excluded_date");
        $stmt->execute([$teamId]);
        $dates = array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'excluded_date');

        echo json_encode(['success' => true, 'excluded_dates' => $dates]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $teamId = isset($data['team_id']) ? (int) $data['team_id'] : null;
    $excludedDates = $data['excluded_dates'] ?? [];

    if (!$teamId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'team_id is required']);
        exit;
    }
    if (!is_array($excludedDates)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'excluded_dates must be an array']);
        exit;
    }

    foreach ($excludedDates as $date) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => "Invalid date: $date"]);
            exit;
        }
    }

    try {
        $pdo->beginTransaction();

        $deleteStmt = $pdo->prepare("DELETE FROM org_run_rate_excluded_days WHERE team_id = ?");
        $deleteStmt->execute([$teamId]);

        if (count($excludedDates) > 0) {
            $insertStmt = $pdo->prepare("INSERT INTO org_run_rate_excluded_days (team_id, excluded_date) VALUES (?, ?)");
            foreach ($excludedDates as $date) {
                $insertStmt->execute([$teamId, $date]);
            }
        }

        $pdo->commit();
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
?>
