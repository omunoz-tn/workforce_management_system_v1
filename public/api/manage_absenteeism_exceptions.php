<?php
/**
 * manage_absenteeism_exceptions.php
 * Employees excused from the Absenteeism Report on every date (Configuration >
 * Reports > Advance Configuration > Absenteeism Report > Exceptions >
 * Employees Exceptions). Their rows are dropped in
 * get_absenteeism_details.php and the report's drill-down, so they never
 * appear as a no-show and never inflate the scheduled-shift denominator.
 *
 * Independent of org_run_rate_excluded_employees: an employee excused here
 * still counts toward Run Rate, and vice versa.
 *
 * GET returns the team's roster alongside the exclusions so the picker can be
 * drawn from one call. The roster comes from org_team_assignments rather than
 * from a report feed, so an employee who happens to have no rows in the current
 * window is still listed and can still be excused ahead of time.
 *
 * POST replaces exceptions only within the given employee_ids scope (one team's
 * roster at a time), so saving one team's picker never touches exclusions
 * recorded for another team.
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
    $teamId = isset($_GET['team_id']) ? (int) $_GET['team_id'] : null;

    try {
        $stmt = $pdo->query("SELECT employee_id FROM org_absenteeism_excluded_employees");
        $excludedIds = array_map('intval', array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'employee_id'));

        $employees = [];
        if ($teamId) {
            $rosterStmt = $pdo->prepare("
                SELECT ota.employee_id,
                       COALESCE(MAX(d.name), CONCAT('Employee #', ota.employee_id)) as name
                FROM org_team_assignments ota
                LEFT JOIN desktime_employee_data d ON d.employee_id = ota.employee_id
                WHERE ota.team_id = ?
                GROUP BY ota.employee_id
                ORDER BY name ASC
            ");
            $rosterStmt->execute([$teamId]);
            $employees = array_map(function ($row) {
                return ['employee_id' => (int) $row['employee_id'], 'name' => $row['name']];
            }, $rosterStmt->fetchAll(PDO::FETCH_ASSOC));

            // Only the exclusions this picker is responsible for, so the caller can
            // POST back exactly what it was shown.
            $rosterIds = array_column($employees, 'employee_id');
            $excludedIds = array_values(array_intersect($excludedIds, $rosterIds));
        }

        echo json_encode([
            'success' => true,
            'employees' => $employees,
            'excluded_employee_ids' => $excludedIds
        ]);
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
        $deleteStmt = $pdo->prepare("DELETE FROM org_absenteeism_excluded_employees WHERE employee_id IN ($inPlaceholders)");
        $deleteStmt->execute($employeeIds);

        if (count($excludedIds) > 0) {
            $insertStmt = $pdo->prepare("INSERT INTO org_absenteeism_excluded_employees (employee_id) VALUES (?)");
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
