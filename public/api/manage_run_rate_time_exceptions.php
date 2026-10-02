<?php
/**
 * manage_run_rate_time_exceptions.php
 * Minutes swallowed at the START of the working window before Run Rate is
 * computed (Configuration > Reports > Advance Configuration > Run Rate Report >
 * Exceptions > Time Exceptions). Applied in RunRateWindowSql.php, which shifts
 * the billed start forward and drops the tracked time the employee accrued
 * inside the exception — see that file for the exact arithmetic.
 *
 * Two levels: org_teams.run_rate_time_exception_minutes is the team's base
 * value, org_run_rate_time_exceptions holds per-employee overrides. No row for
 * an employee means "inherit the team", so an employee who should have NO
 * exception while their team has one is stored as an explicit 0.
 *
 * POST accepts either level or both at once. The employee level replaces the
 * full set for the employee_ids scope it is given (one team's roster at a
 * time), mirroring the other per-team exception endpoints.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

const RR_MAX_EXCEPTION_MINUTES = 1440;

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $teamId = isset($_GET['team_id']) ? (int) $_GET['team_id'] : null;

    if (!$teamId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'team_id is required']);
        exit;
    }

    try {
        $stmt = $pdo->prepare("SELECT run_rate_time_exception_minutes FROM org_teams WHERE id = ?");
        $stmt->execute([$teamId]);
        $teamMinutes = $stmt->fetchColumn();

        if ($teamMinutes === false) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Team not found']);
            exit;
        }

        $stmt = $pdo->prepare("SELECT rrte.employee_id, rrte.exception_minutes
            FROM org_run_rate_time_exceptions rrte
            INNER JOIN org_team_assignments ota ON ota.employee_id = rrte.employee_id
            WHERE ota.team_id = ?");
        $stmt->execute([$teamId]);
        $overrides = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode([
            'success' => true,
            'team_minutes' => (int) $teamMinutes,
            'overrides' => $overrides
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $teamId = isset($data['team_id']) ? (int) $data['team_id'] : null;
    $hasTeamMinutes = array_key_exists('team_minutes', $data);
    $hasOverrides = array_key_exists('employee_ids', $data);

    if (!$hasTeamMinutes && !$hasOverrides) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Nothing to save: send team_minutes and/or employee_ids']);
        exit;
    }

    $teamMinutes = null;
    if ($hasTeamMinutes) {
        if (!$teamId) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'team_id is required to save team_minutes']);
            exit;
        }
        $teamMinutes = $data['team_minutes'];
        if (!is_numeric($teamMinutes) || (int) $teamMinutes < 0 || (int) $teamMinutes > RR_MAX_EXCEPTION_MINUTES) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'team_minutes must be a whole number of minutes between 0 and ' . RR_MAX_EXCEPTION_MINUTES]);
            exit;
        }
        $teamMinutes = (int) $teamMinutes;
    }

    $employeeIds = [];
    $toStore = [];
    if ($hasOverrides) {
        $employeeIds = $data['employee_ids'];
        $overrides = $data['overrides'] ?? [];

        if (!is_array($employeeIds) || count($employeeIds) === 0) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'employee_ids must be a non-empty array']);
            exit;
        }
        if (!is_array($overrides)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'overrides must be an array']);
            exit;
        }

        $employeeIds = array_map('intval', $employeeIds);

        foreach ($overrides as $entry) {
            $employeeId = isset($entry['employee_id']) ? (int) $entry['employee_id'] : null;
            $minutes = $entry['exception_minutes'] ?? null;

            if (!in_array($employeeId, $employeeIds, true)) {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => "employee_id $employeeId is not in employee_ids"]);
                exit;
            }
            // null / '' means "inherit the team" — stored as the absence of a row.
            if ($minutes === null || $minutes === '') {
                continue;
            }
            if (!is_numeric($minutes) || (int) $minutes < 0 || (int) $minutes > RR_MAX_EXCEPTION_MINUTES) {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => "exception_minutes for employee $employeeId must be a whole number of minutes between 0 and " . RR_MAX_EXCEPTION_MINUTES]);
                exit;
            }

            $toStore[] = ['employee_id' => $employeeId, 'exception_minutes' => (int) $minutes];
        }
    }

    try {
        $pdo->beginTransaction();

        if ($hasTeamMinutes) {
            $stmt = $pdo->prepare("UPDATE org_teams SET run_rate_time_exception_minutes = ? WHERE id = ?");
            $stmt->execute([$teamMinutes, $teamId]);
        }

        if ($hasOverrides) {
            $inPlaceholders = implode(',', array_fill(0, count($employeeIds), '?'));
            $deleteStmt = $pdo->prepare("DELETE FROM org_run_rate_time_exceptions WHERE employee_id IN ($inPlaceholders)");
            $deleteStmt->execute($employeeIds);

            if (count($toStore) > 0) {
                $insertStmt = $pdo->prepare("INSERT INTO org_run_rate_time_exceptions (employee_id, exception_minutes) VALUES (?, ?)");
                foreach ($toStore as $entry) {
                    $insertStmt->execute([$entry['employee_id'], $entry['exception_minutes']]);
                }
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
