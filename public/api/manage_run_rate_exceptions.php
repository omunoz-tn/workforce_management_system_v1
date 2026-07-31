<?php
/**
 * manage_run_rate_exceptions.php
 * Employees excluded from Run Rate reporting (Configuration > Reports >
 * Advance Configuration > Run Rate Report > Employees Exceptions). Excluded
 * employees are filtered out of get_dashboard_stats.php's MTD query and
 * get_daily_run_rate.php, so they never contribute to any Run Rate figure —
 * the Dashboard card, the standalone Run Rate Report, and their drill-downs.
 *
 * POST replaces exceptions only within the given employee_ids scope (one
 * team's roster at a time), so saving one team's picker never touches
 * exclusions recorded for another team.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    try {
        $stmt = $pdo->query("SELECT employee_id FROM org_run_rate_excluded_employees");
        $ids = array_map('intval', array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'employee_id'));

        echo json_encode(['success' => true, 'excluded_employee_ids' => $ids]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $employeeIds = $data['employee_ids'] ?? null;
    $excludedIds = $data['excluded_employee_ids'] ?? [];

    if (!is_array($employeeIds) || count($employeeIds) === 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'employee_ids array is required']);
        exit;
    }

    $employeeIds = array_map('intval', $employeeIds);
    $excludedIds = array_values(array_intersect(array_map('intval', $excludedIds), $employeeIds));

    try {
        $pdo->beginTransaction();

        $inPlaceholders = implode(',', array_fill(0, count($employeeIds), '?'));
        $deleteStmt = $pdo->prepare("DELETE FROM org_run_rate_excluded_employees WHERE employee_id IN ($inPlaceholders)");
        $deleteStmt->execute($employeeIds);

        if (count($excludedIds) > 0) {
            $insertStmt = $pdo->prepare("INSERT INTO org_run_rate_excluded_employees (employee_id) VALUES (?)");
            foreach ($excludedIds as $employeeId) {
                $insertStmt->execute([$employeeId]);
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
