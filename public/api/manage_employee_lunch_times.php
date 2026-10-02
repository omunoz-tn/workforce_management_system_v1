<?php
/**
 * manage_employee_lunch_times.php
 * Per-employee, per-weekday lunch overrides
 * (Employees > Teams > Assign Members > Lunch Time > Employee Lunch Time).
 *
 * org_teams.lunch_time stays the team-wide default, set on the same page under
 * Team Lunch Time. An employee only stores rows for the weekdays they differ on, so
 * changing the team default still moves everybody who was left on it:
 *
 *   effective lunch = COALESCE(org_employee_lunch_times.lunch_time, org_teams.lunch_time, 0)
 *
 * The effective value is what the Run Rate deducts from scheduled hours
 * (RunRateWindowSql.php), what the absenteeism reports subtract from a lost day, and what
 * the Schedule Board and Shift Management take off each day's card.
 *
 * GET  ?team_id=N -> that team's members, each with their overrides, plus the team default
 * GET             -> every override, keyed by employee (no team scoping)
 * POST { team_id, lunch_time?, lunch_times: { employee_id: { weekday: minutes } } }
 *      -> replaces the override set of exactly the employees named, and optionally the
 *         team default
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'EmployeeLunchTimes.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // team_id is optional, and 0 is legitimate: the Assign Members modal opens on a team
    // that has not been saved yet, which has no members and no overrides.
    $teamId = isset($_GET['team_id']) && is_numeric($_GET['team_id']) ? (int) $_GET['team_id'] : null;

    try {
        if ($teamId === null) {
            echo json_encode([
                'success' => true,
                'lunch_times' => (object) fetchEmployeeLunchTimes($pdo)
            ]);
            exit;
        }

        $stmt = $pdo->prepare("SELECT lunch_time FROM org_teams WHERE id = ?");
        $stmt->execute([$teamId]);
        $teamLunch = $stmt->fetchColumn();

        // Names come from the newest synced row, the same place every other screen reads
        // an employee's identity from.
        $stmt = $pdo->prepare(
            "SELECT ota.employee_id, d.name
             FROM org_team_assignments ota
             LEFT JOIN (
                 SELECT dd.employee_id, dd.name
                 FROM desktime_employee_data dd
                 INNER JOIN (
                     SELECT employee_id, MAX(log_date) AS max_log_date
                     FROM desktime_employee_data
                     GROUP BY employee_id
                 ) latest ON latest.employee_id = dd.employee_id
                         AND latest.max_log_date = dd.log_date
                 GROUP BY dd.employee_id
             ) d ON d.employee_id = ota.employee_id
             WHERE ota.team_id = ?
             ORDER BY d.name"
        );
        $stmt->execute([$teamId]);
        $members = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $overrides = fetchEmployeeLunchTimes($pdo, array_column($members, 'employee_id'));

        echo json_encode([
            'success' => true,
            'team_lunch_time' => $teamLunch === false ? null : (int) $teamLunch,
            'employees' => array_map(function ($m) use ($overrides) {
                $id = (int) $m['employee_id'];
                return [
                    'employee_id' => $id,
                    'name' => $m['name'],
                    // (object) so an employee with no overrides serializes as {} and not [].
                    'lunch_times' => (object) ($overrides[$id] ?? [])
                ];
            }, $members)
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
    $lunchTimes = $data['lunch_times'] ?? [];

    if (!is_array($lunchTimes)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'lunch_times must be an object']);
        exit;
    }

    try {
        validateEmployeeLunchTimes($lunchTimes);
    } catch (InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        exit;
    }

    try {
        $pdo->beginTransaction();

        // The team default travels with the overrides so one save can move both, the way
        // the modal presents them: one page, two sections.
        if ($teamId && array_key_exists('lunch_time', $data)) {
            $pdo->prepare("UPDATE org_teams SET lunch_time = ? WHERE id = ?")
                ->execute([(int) $data['lunch_time'], $teamId]);
        }

        $stored = saveEmployeeLunchTimes($pdo, $lunchTimes);
        $pdo->commit();
        echo json_encode(['success' => true, 'stored' => $stored]);
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
