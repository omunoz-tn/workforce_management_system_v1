<?php
// Disable error output for clean JSON
ini_set('display_errors', 0);
error_reporting(0);

header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'sync_desktime_core.php';
require_once 'RunRateWindowSql.php';

session_start();
// Check if user has team-level restrictions
$isRestricted = isset($_SESSION['allowed_teams']) && !empty($_SESSION['allowed_teams']) && $_SESSION['role_name'] !== 'Admin';
$allowedTeams = $isRestricted ? $_SESSION['allowed_teams'] : [];
$teamFilter = $isRestricted ? " AND ota.team_id IN (" . implode(',', array_map('intval', $allowedTeams)) . ") " : "";

try {
    // 0. Extract Date Range (Default to today for dashboard)
    $fromDate = isset($_GET['from']) ? $_GET['from'] : date('Y-m-d');
    $toDate = isset($_GET['to']) ? $_GET['to'] : date('Y-m-d');

    // MTD Logic: If a custom range is provided, use it. Otherwise use MTD start.
    $mtdStart = isset($_GET['from']) ? $_GET['from'] : date('Y-m-01');

    // 0. Auto-Sync Logic (Smart Refresh - only for today)
    $wasAutoSynced = false;
    if ($toDate === date('Y-m-d')) {
        $syncCheckQuery = "SELECT MAX(updated_at) as last_sync FROM desktime_employee_data WHERE log_date = :log_date";
        $stmt = $pdo->prepare($syncCheckQuery);
        $stmt->execute(['log_date' => date('Y-m-d')]);
        $syncInfo = $stmt->fetch(PDO::FETCH_ASSOC);

        $lastSync = $syncInfo['last_sync'] ? strtotime($syncInfo['last_sync']) : 0;
        $currentTime = time();
        $syncThreshold = 600; // 10 minutes

        if (($currentTime - $lastSync) > $syncThreshold) {
            syncDeskTime($pdo, $env);
            $wasAutoSynced = true;
        }
    }

    // 1. General Stats (Filtered by Visibility)
    $statsQuery = "SELECT 
        COUNT(*) as total_employees,
        SUM(CASE WHEN d.is_online = 1 THEN 1 ELSE 0 END) as online_count,
        SUM(CASE WHEN d.is_online = 0 THEN 1 ELSE 0 END) as offline_count,
        SUM(CASE WHEN d.is_late = 1 AND d.work_starts != '00:00:00' THEN 1 ELSE 0 END) as late_count,
        AVG(NULLIF(d.productivity, 0)) as avg_productivity,
        AVG(d.efficiency) as avg_efficiency,
        SUM(CASE WHEN d.is_online = 0 AND d.arrived IS NULL AND d.work_starts != '00:00:00' AND d.work_ends > d.work_starts AND (
            (d.log_date < CURDATE()) OR (d.log_date = CURDATE() AND CURTIME() > d.work_starts)
        ) THEN 1 ELSE 0 END) as absenteeism_count,
        AVG(NULLIF(CASE WHEN d.work_ends > d.work_starts AND d.work_starts != '00:00:00' AND d.work_ends != '00:00:00' THEN LEAST((d.at_work_time / NULLIF(TIME_TO_SEC(d.work_ends) - TIME_TO_SEC(d.work_starts), 0)) * 100, 100) ELSE NULL END, 0)) as adherence_pct,
        SUM(CASE WHEN d.after_work_time > 0 THEN 1 ELSE 0 END) / COUNT(*) * 100 as overtime_pct,
        COUNT(DISTINCT CASE WHEN d.is_online = 1 THEN COALESCE(ot.name, d.group_name) END) as active_teams,
        ROUND(SUM(d.desktime_time) / 3600, 2) as total_hours,
        SUM(CASE WHEN d.desktime_time > 0 THEN 1 ELSE 0 END) as employees_tracked
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    WHERE d.log_date BETWEEN :from AND :to
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)";

    $stmt = $pdo->prepare($statsQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $generalStats = $stmt->fetch(PDO::FETCH_ASSOC);

    // 2. All Teams (Filtered and Named by org_teams)
    $teamQuery = "SELECT 
        COALESCE(ot.name, d.group_name) as group_name,
        AVG(NULLIF(d.productivity, 0)) as avg_productivity,
        COUNT(*) as employee_count,
        SUM(CASE WHEN d.is_online = 1 THEN 1 ELSE 0 END) as online_count,
        SUM(CASE WHEN d.is_online = 0 THEN 1 ELSE 0 END) as offline_count,
        SUM(CASE WHEN d.is_late = 1 AND d.work_starts != '00:00:00' THEN 1 ELSE 0 END) as late_count,
        SUM(CASE WHEN d.work_starts != '00:00:00' THEN 1 ELSE 0 END) as scheduled_count,
        SUM(d.desktime_time) as total_desktime,
        SUM(CASE WHEN d.desktime_time > 0 THEN 1 ELSE 0 END) as tracked_count,
        AVG(NULLIF(CASE WHEN d.work_ends > d.work_starts AND d.work_starts != '00:00:00' AND d.work_ends != '00:00:00' THEN LEAST((d.at_work_time / NULLIF(TIME_TO_SEC(d.work_ends) - TIME_TO_SEC(d.work_starts), 0)) * 100, 100) ELSE NULL END, 0)) as avg_adherence,
        SUM(CASE WHEN d.after_work_time > 0 THEN 1 ELSE 0 END) as overtime_count,
        SUM(CASE WHEN d.work_starts != '00:00:00' AND d.work_ends > d.work_starts AND (d.at_work_time / NULLIF(TIME_TO_SEC(d.work_ends) - TIME_TO_SEC(d.work_starts), 0)) * 100 < 90 THEN 1 ELSE 0 END) as low_adherence_count
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    WHERE d.log_date BETWEEN :from AND :to
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)
    $teamFilter
    GROUP BY COALESCE(ot.name, d.group_name)
    ORDER BY group_name ASC";


    $stmt = $pdo->prepare($teamQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $teamStats = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 3. Status Breakdown
    $statusQuery = "SELECT 
        SUM(CASE WHEN d.is_online = 1 THEN 1 ELSE 0 END) as online,
        SUM(CASE WHEN d.is_online = 0 THEN 1 ELSE 0 END) as offline
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    WHERE d.log_date BETWEEN :from AND :to
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)";
    $stmt = $pdo->prepare($statusQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $statusBreakdown = $stmt->fetch(PDO::FETCH_ASSOC);

    // 4. Top Productive Team
    $topTeamQuery = "SELECT 
        COALESCE(ot.name, d.group_name) as group_name,
        AVG(NULLIF(d.productivity, 0)) as avg_productivity,
        COUNT(*) as employee_count,
        SUM(CASE WHEN d.is_online = 1 THEN 1 ELSE 0 END) as online_count
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    WHERE d.log_date BETWEEN :from AND :to
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)
    $teamFilter
    GROUP BY COALESCE(ot.name, d.group_name)
    HAVING SUM(CASE WHEN d.is_online = 1 THEN 1 ELSE 0 END) > 0
    ORDER BY avg_productivity DESC
    LIMIT 1";

    $stmt = $pdo->prepare($topTeamQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $topTeam = $stmt->fetch(PDO::FETCH_ASSOC);

    $mtdQuery = "SELECT
        d.employee_id,
        d.name,
        COALESCE(ot.name, d.group_name) as team_name,
        MAX(rre.employee_id IS NOT NULL) as is_excluded,
        MAX(COALESCE(brp.billable_percentage, 100)) as billable_percentage,
        " . rrActualHoursSum() . "
            * (MAX(COALESCE(brp.billable_percentage, 100)) / 100) as mtd_actual,
        SUM(" . rrScheduledHours() . ")
            * (MAX(COALESCE(brp.billable_percentage, 100)) / 100) as mtd_scheduled,
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
    AND red.id IS NULL
    AND red_emp.id IS NULL
    AND " . rrNonWorkingHolidayFilter() . "
    GROUP BY d.employee_id, d.name, team_name";
    $stmt = $pdo->prepare($mtdQuery);
    $stmt->execute(['from' => $mtdStart, 'to' => $toDate]);
    $mtdEmployeeData = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'stats' => $generalStats,
        'teamStats' => $teamStats,
        'statusBreakdown' => $statusBreakdown,
        'topTeam' => $topTeam ?: null,
        'mtdEmployeeData' => $mtdEmployeeData,
        'lastUpdate' => date('c'),
        'autoSynced' => $wasAutoSynced
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>
