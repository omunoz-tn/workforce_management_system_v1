<?php
/**
 * manage_absenteeism_excluded_employee_days.php
 * Calendar days excused for a single EMPLOYEE in the Absenteeism Report
 * (Configuration > Reports > Advance Configuration > Absenteeism Report >
 * Exceptions > Days Exceptions > Employee) — approved leave, a medical day,
 * anything that should not read as a no-show. Filtered out in
 * get_absenteeism_details.php and the report's drill-down per
 * (employee_id, log_date); narrower than the team-wide
 * org_absenteeism_excluded_days, which this does not touch.
 *
 * POST replaces the full excused-day set for the given employee_id in one shot
 * (mirrors the team-level manage_absenteeism_excluded_days.php).
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'AbsenteeismExceptionsSql.php';

$method = $_SERVER['REQUEST_METHOD'];

try {
    ensureAbsenteeismExceptionTables($pdo);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    exit;
}

if ($method === 'GET') {
    $employeeId = isset($_GET['employee_id']) ? (int) $_GET['employee_id'] : null;

    if (!$employeeId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'employee_id is required']);
        exit;
    }

    try {
        $stmt = $pdo->prepare("SELECT excluded_date FROM org_absenteeism_excluded_employee_days WHERE employee_id = ? ORDER BY excluded_date");
        $stmt->execute([$employeeId]);
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
    $employeeId = isset($data['employee_id']) ? (int) $data['employee_id'] : null;
    $excludedDates = $data['excluded_dates'] ?? [];

    if (!$employeeId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'employee_id is required']);
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

        $deleteStmt = $pdo->prepare("DELETE FROM org_absenteeism_excluded_employee_days WHERE employee_id = ?");
        $deleteStmt->execute([$employeeId]);

        if (count($excludedDates) > 0) {
            $insertStmt = $pdo->prepare("INSERT INTO org_absenteeism_excluded_employee_days (employee_id, excluded_date) VALUES (?, ?)");
            foreach ($excludedDates as $date) {
                $insertStmt->execute([$employeeId, $date]);
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
