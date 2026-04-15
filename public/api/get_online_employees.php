<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $status = isset($_GET['status']) ? $_GET['status'] : 'all';
    $team = isset($_GET['team']) ? $_GET['team'] : null;
    $type = isset($_GET['type']) ? $_GET['type'] : null;
    $targetTeamId = isset($_GET['team_id']) ? (int) $_GET['team_id'] : null;

    $fromDate = isset($_GET['from']) ? $_GET['from'] : date('Y-m-d');
    $toDate = isset($_GET['to']) ? $_GET['to'] : date('Y-m-d');

    $query = "SELECT d.employee_id, d.name,
                     ot.name as team_name,
                     d.group_name as desktime_group,
                     og.name as parent_group_name,
                     COALESCE(ot.name, d.group_name) as group_name,
                     d.is_online, d.arrived, d.left_time, d.work_starts, d.work_ends,
                     d.productivity, d.efficiency, d.after_work_time, d.is_late,
                     d.online_time, d.offline_time, d.desktime_time, d.at_work_time, d.productive_time,
                     COALESCE(d.is_billable, 1) as is_billable,
                     d.log_date,
                     COALESCE(ot.lunch_time, 0) / 60.0 as lunch_deduction_hours
              FROM desktime_employee_data d
              LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
              LEFT JOIN org_teams ot ON ota.team_id = ot.id
              LEFT JOIN org_groups og ON ot.group_id = og.id
              WHERE d.log_date BETWEEN ? AND ?
              AND (ot.is_visible IS NULL OR ot.is_visible = 1)
              AND (og.is_visible IS NULL OR og.is_visible = 1)";
    $params = [$fromDate, $toDate];

    if ($status === 'online') {
        $query .= " AND d.is_online = 1";
    } elseif ($status === 'offline') {
        $query .= " AND d.is_online = 0";
    }

    if ($type === 'absenteeism') {
        $query .= " AND d.is_online = 0 AND d.arrived IS NULL AND d.work_starts != '00:00:00' AND CURTIME() > d.work_starts";
    }

    if ($team) {
        $query .= " AND COALESCE(ot.name, d.group_name) = ?";
        $params[] = $team;
    }

    if ($targetTeamId) {
        $query .= " AND ota.team_id = ?";
        $params[] = $targetTeamId;
    }

    $query .= " ORDER BY d.name ASC";

    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $employees = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $timeRow = $pdo->query("SELECT CURTIME() as cur_time")->fetch(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $employees,
        'serverTime' => $timeRow['cur_time']
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>