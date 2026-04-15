<?php
// Disable error output for clean JSON
ini_set('display_errors', 0);
error_reporting(0);

header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $from = isset($_GET['from']) ? $_GET['from'] : date('Y-m-01');
    $to = isset($_GET['to']) ? $_GET['to'] : date('Y-m-d');
    $team = isset($_GET['team']) ? $_GET['team'] : null;

    $query = "SELECT 
        d.employee_id,
        d.name,
        d.log_date,
        COALESCE(ot.name, d.group_name) as team_name,
        SUM(d.desktime_time) / 3600 as daily_actual,
        SUM(
            CASE
                -- Primary: employee has a valid schedule for this day
                WHEN d.work_starts != '00:00:00'
                     AND d.work_ends NOT IN ('00:00:00', '23:59:59')
                     AND d.work_ends > d.work_starts
                THEN (TIME_TO_SEC(d.work_ends) - TIME_TO_SEC(d.work_starts)) / 3600
                -- Fallback: no schedule today, use employee's most common historical schedule
                WHEN sched.work_starts IS NOT NULL
                THEN (TIME_TO_SEC(sched.work_ends) - TIME_TO_SEC(sched.work_starts)) / 3600
                ELSE 0
            END
        ) as daily_scheduled,
        SUM(
            CASE
                -- Primary: employee has a valid schedule for this day
                WHEN d.work_starts != '00:00:00'
                     AND d.work_ends NOT IN ('00:00:00', '23:59:59')
                     AND d.work_ends > d.work_starts
                THEN COALESCE(ot.lunch_time, 0) / 60.0
                -- Fallback: apply lunch deduction when using historical schedule
                WHEN sched.work_starts IS NOT NULL
                THEN COALESCE(ot.lunch_time, 0) / 60.0
                ELSE 0
            END
        ) as lunch_deduction_hours
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    -- Fallback schedule: employee's most frequently used valid shift (only joins when today has no schedule)
    LEFT JOIN (
        SELECT employee_id, work_starts, work_ends
        FROM (
            SELECT
                employee_id,
                work_starts,
                work_ends,
                ROW_NUMBER() OVER (
                    PARTITION BY employee_id
                    ORDER BY COUNT(*) DESC
                ) as rn
            FROM desktime_employee_data
            WHERE work_starts != '00:00:00'
              AND work_ends NOT IN ('00:00:00', '23:59:59')
              AND work_ends > work_starts
            GROUP BY employee_id, work_starts, work_ends
        ) ranked
        WHERE rn = 1
    ) sched ON d.employee_id = sched.employee_id
           AND d.work_starts = '00:00:00'
    WHERE d.log_date BETWEEN :from AND :to
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)";

    $params = ['from' => $from, 'to' => $to];

    if ($team) {
        $query .= " AND (ot.name = :team OR d.group_name = :team)";
        $params['team'] = $team;
    }

    $query .= " GROUP BY d.employee_id, d.name, d.log_date, team_name
                ORDER BY d.log_date ASC, d.name ASC";

    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $data,
        'count' => count($data)
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>
