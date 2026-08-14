<?php
/**
 * manage_run_rate_billable_percentage.php
 * Per-employee "Billable %" (Run Rate Report > Exceptions > Billable %).
 * Scales BOTH actual and scheduled hours by the same factor in
 * get_dashboard_stats.php's MTD query and get_daily_run_rate.php before Run
 * Rate is computed — e.g. a 50% employee's 7.99h/8h day becomes 3.995h/4h.
 * Absence from the table means 100% (no scaling), so only non-default rows
 * are stored.
 *
 * POST replaces the full set for the given employee_ids scope (one team's
 * roster at a time), mirroring the other per-team exception endpoints.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    try {
        $stmt = $pdo->query("SELECT employee_id, billable_percentage FROM org_run_rate_billable_percentage");
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(['success' => true, 'percentages' => $rows]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $employeeIds = $data['employee_ids'] ?? null;
    $percentages = $data['percentages'] ?? [];

    if (!is_array($employeeIds) || count($employeeIds) === 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'employee_ids array is required']);
        exit;
    }
    if (!is_array($percentages)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'percentages must be an array']);
        exit;
    }

    $employeeIds = array_map('intval', $employeeIds);
    $toStore = [];
    foreach ($percentages as $entry) {
        $employeeId = isset($entry['employee_id']) ? (int) $entry['employee_id'] : null;
        $percentage = $entry['billable_percentage'] ?? null;

        if (!in_array($employeeId, $employeeIds, true)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => "employee_id $employeeId is not in employee_ids"]);
            exit;
        }
        if (!is_numeric($percentage) || $percentage < 0 || $percentage > 100) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => "billable_percentage for employee $employeeId must be a number between 0 and 100"]);
            exit;
        }

        // Only store deviations from the 100% default.
        if (round((float) $percentage, 2) !== 100.0) {
            $toStore[] = ['employee_id' => $employeeId, 'billable_percentage' => round((float) $percentage, 2)];
        }
    }

    try {
        $pdo->beginTransaction();

        $inPlaceholders = implode(',', array_fill(0, count($employeeIds), '?'));
        $deleteStmt = $pdo->prepare("DELETE FROM org_run_rate_billable_percentage WHERE employee_id IN ($inPlaceholders)");
        $deleteStmt->execute($employeeIds);

        if (count($toStore) > 0) {
            $insertStmt = $pdo->prepare("INSERT INTO org_run_rate_billable_percentage (employee_id, billable_percentage) VALUES (?, ?)");
            foreach ($toStore as $entry) {
                $insertStmt->execute([$entry['employee_id'], $entry['billable_percentage']]);
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
