<?php
// Disable error output for clean JSON
ini_set('display_errors', 0);
error_reporting(0);

header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'RunRateWindowSql.php';

try {
    session_start();
    $isRestricted = isset($_SESSION['allowed_teams']) && !empty($_SESSION['allowed_teams']) && $_SESSION['role_name'] !== 'Admin';
    $allowedTeams = $isRestricted ? $_SESSION['allowed_teams'] : [];
    $teamFilter = $isRestricted ? " AND ota.team_id IN (" . implode(',', array_map('intval', $allowedTeams)) . ") " : "";

    $from = isset($_GET['from']) ? $_GET['from'] : date('Y-m-01');
    $to = isset($_GET['to']) ? $_GET['to'] : date('Y-m-d');
    $team = isset($_GET['team']) ? $_GET['team'] : null;

    $query = "SELECT
        d.employee_id,
        d.name,
        d.log_date,
        COALESCE(ot.name, d.group_name) as team_name,
        " . rrActualHoursSum() . "
            * (MAX(COALESCE(brp.billable_percentage, 100)) / 100) as daily_actual,
        SUM(" . rrScheduledHours() . ")
            * (MAX(COALESCE(brp.billable_percentage, 100)) / 100) as daily_scheduled,
        SUM(" . rrLunchHours() . ") as lunch_deduction_hours
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    LEFT JOIN org_run_rate_excluded_employees rre ON d.employee_id = rre.employee_id
    LEFT JOIN org_run_rate_excluded_days red ON red.team_id = ota.team_id AND red.excluded_date = d.log_date
    LEFT JOIN org_run_rate_excluded_employee_days red_emp ON red_emp.employee_id = d.employee_id AND red_emp.excluded_date = d.log_date
    LEFT JOIN org_run_rate_billable_percentage brp ON brp.employee_id = d.employee_id
    " . rrCampaignExclusionJoin() . "
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
    AND (og.is_visible IS NULL OR og.is_visible = 1)
    AND rre.employee_id IS NULL
    AND red.id IS NULL
    AND red_emp.id IS NULL
    AND " . rrNonWorkingHolidayFilter() . "
    $teamFilter";

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
