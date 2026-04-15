<?php
/**
 * get_absenteeism_details.php
 * Provides comprehensive absenteeism data including trends, team impact, and lost hours.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $fromDate = isset($_GET['from']) ? $_GET['from'] : date('Y-m-d');
    $toDate = isset($_GET['to']) ? $_GET['to'] : date('Y-m-d');

    // 1. Definition of Absenteeism
    // Criteria: Offline, No Arrival time recorded, Valid schedule present, and time has passed.
    $absentCondition = "d.is_online = 0 AND d.arrived IS NULL AND d.work_starts != '00:00:00' AND d.work_ends > d.work_starts AND (
        (d.log_date < CURDATE()) OR (d.log_date = CURDATE() AND CURTIME() > d.work_starts)
    )";

    $summaryQuery = "SELECT 
        SUM(CASE WHEN $absentCondition THEN 1 ELSE 0 END) as total_absences,
        COUNT(DISTINCT CASE WHEN $absentCondition THEN d.employee_id END) as unique_absentees,
        ROUND(SUM(CASE WHEN $absentCondition THEN (TIME_TO_SEC(d.work_ends) - TIME_TO_SEC(d.work_starts) - (COALESCE(ot.lunch_time, 0) * 60)) ELSE 0 END) / 3600, 2) as lost_hours,
        COUNT(DISTINCT d.log_date) as days_covered,
        COUNT(*) as total_scheduled
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    WHERE d.log_date BETWEEN :from AND :to
    AND d.work_starts != '00:00:00' AND d.work_ends > d.work_starts
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)";

    $stmt = $pdo->prepare($summaryQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $summary = $stmt->fetch(PDO::FETCH_ASSOC);

    // 3. Trend Data (Daily absence counts)
    $trendQuery = "SELECT 
        d.log_date,
        COUNT(*) as count
    FROM desktime_employee_data d
    WHERE d.log_date BETWEEN :from AND :to
    AND $absentCondition
    GROUP BY d.log_date
    ORDER BY d.log_date ASC";

    $stmt = $pdo->prepare($trendQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $trend = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $teamQuery = "SELECT 
        COALESCE(ot.name, d.group_name) as group_name,
        SUM(CASE WHEN $absentCondition THEN 1 ELSE 0 END) as absence_count,
        ROUND(SUM(CASE WHEN $absentCondition THEN (TIME_TO_SEC(d.work_ends) - TIME_TO_SEC(d.work_starts) - (COALESCE(ot.lunch_time, 0) * 60)) ELSE 0 END) / 3600, 2) as lost_hours,
        COUNT(DISTINCT CASE WHEN $absentCondition THEN d.employee_id END) as unique_absentees,
        COUNT(*) as total_scheduled
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    WHERE d.log_date BETWEEN :from AND :to
    AND d.work_starts != '00:00:00' AND d.work_ends > d.work_starts
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)
    GROUP BY group_name
    ORDER BY lost_hours DESC";

    $stmt = $pdo->prepare($teamQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $teamStats = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 5. Global Roster Context (For rates)
    $rosterQuery = "SELECT COUNT(*) as scheduled_count 
                    FROM desktime_employee_data d 
                    WHERE d.log_date BETWEEN :from AND :to 
                    AND d.work_starts != '00:00:00'";
    $stmt = $pdo->prepare($rosterQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $roster = $stmt->fetch(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'summary' => $summary,
        'trend' => $trend,
        'teamStats' => $teamStats,
        'globalScheduled' => $roster['scheduled_count'] ?? 0,
        'serverTime' => date('H:i:s'),
        'lastUpdate' => date('c')
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
