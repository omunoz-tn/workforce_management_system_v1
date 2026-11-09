<?php
/**
 * get_absenteeism_details.php
 * Provides comprehensive absenteeism data including trends, team impact, and lost hours.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'sync_desktime_core.php';
require_once 'AbsenteeismExceptionsSql.php';
require_once 'EmployeeLunchTimes.php';
require_once 'WorkScheduleSql.php';

try {
    session_start();
    $teamFilter = team_filter_sql('ota.team_id');

    // Per-team exceptions configured under Advance Configuration > Absenteeism Report.
    // An excused employee, team-day or employee-day is dropped from every query below,
    // so it counts neither as an absence nor as a scheduled shift.
    ensureAbsenteeismExceptionTables($pdo);
    $absJoins = absExceptionJoins();
    $absFilter = absExceptionFilter();

    $fromDate = isset($_GET['from']) ? $_GET['from'] : date('Y-m-d');
    $toDate = isset($_GET['to']) ? $_GET['to'] : date('Y-m-d');
    $today = date('Y-m-d');

    // Smart refresh for ranges that include today, to avoid stale false-positive absences.
    $wasAutoSynced = false;
    if ($fromDate <= $today && $toDate >= $today) {
        $syncCheckQuery = "SELECT TIMESTAMPDIFF(SECOND, MAX(updated_at), NOW()) as sync_age FROM desktime_employee_data WHERE log_date = :log_date";
        $stmt = $pdo->prepare($syncCheckQuery);
        $stmt->execute(['log_date' => $today]);
        $syncInfo = $stmt->fetch(PDO::FETCH_ASSOC);

        // Age measured on the DB clock: updated_at is written with CURRENT_TIMESTAMP, and the
        // DB and PHP time zones differ (by an hour since the Nov 1 DST change), which made
        // every request look stale and run a 30s+ DeskTime sync.
        $syncAge = $syncInfo['sync_age'] === null ? PHP_INT_MAX : (int) $syncInfo['sync_age'];
        $syncThreshold = 600; // 10 minutes

        if ($syncAge > $syncThreshold) {
            syncDeskTime($pdo, $env);
            $wasAutoSynced = true;
        }
    }

    // The shift the employee was expected on, resolved the same way every other report
    // resolves it: Shift Management's schedule first, DeskTime's own window second, nothing
    // third (see WorkScheduleSql.php). get_attendance_details.php builds the identical pair,
    // which is what keeps the two reports agreeing on what an absence is.
    //
    // Reading the schedule through this instead of straight off d.work_starts is what lets
    // an absence survive the employee leaving DeskTime: DeskTime stops answering with a
    // schedule for someone it no longer holds, and a re-sync of a past range then blanked
    // the shift out and took the absence with it.
    $schedStart = shiftEffectiveStartSql();
    $schedEnd = shiftEffectiveEndSql();

    // Both the numerator and the denominator below key off this pair. They have to: an
    // absence is a scheduled shift nobody showed up for, so anything that counts as
    // "scheduled" in one has to count as "scheduled" in the other.
    $scheduledCondition = "$schedStart IS NOT NULL AND $schedEnd > $schedStart";

    // 1. Definition of Absenteeism
    // Criteria: Offline, No Arrival time recorded, a shift on the books, and time has passed.
    $absentCondition = "d.is_online = 0 AND d.arrived IS NULL AND $scheduledCondition AND (
        (d.log_date < CURDATE()) OR (d.log_date = CURDATE() AND CURTIME() > $schedStart)
    )";

    $summaryQuery = "SELECT 
        SUM(CASE WHEN $absentCondition THEN 1 ELSE 0 END) as total_absences,
        COUNT(DISTINCT CASE WHEN $absentCondition THEN d.employee_id END) as unique_absentees,
        ROUND(SUM(CASE WHEN $absentCondition THEN GREATEST(TIME_TO_SEC($schedEnd) - TIME_TO_SEC($schedStart) - (" . elLunchMinutes() . " * 60), 0) ELSE 0 END) / 3600, 2) as lost_hours,
        COUNT(DISTINCT d.log_date) as days_covered,
        COUNT(*) as total_scheduled,
        ROUND((SUM(CASE WHEN $absentCondition THEN 1 ELSE 0 END) * 100.0) / NULLIF(COUNT(*), 0), 2) as absence_rate
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    " . elLunchJoin() . "
    $absJoins
    " . shiftPatternJoinSql() . "
    WHERE d.log_date BETWEEN :from AND :to
    AND $scheduledCondition
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)
    $teamFilter
    $absFilter";

    $stmt = $pdo->prepare($summaryQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $summary = $stmt->fetch(PDO::FETCH_ASSOC);

    // 3. Trend Data (Daily absence counts)
    $trendQuery = "SELECT 
        d.log_date,
        SUM(CASE WHEN $absentCondition THEN 1 ELSE 0 END) as absence_count,
        COUNT(*) as total_scheduled,
        ROUND((SUM(CASE WHEN $absentCondition THEN 1 ELSE 0 END) * 100.0) / NULLIF(COUNT(*), 0), 2) as absence_rate
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    $absJoins
    " . shiftPatternJoinSql() . "
    WHERE d.log_date BETWEEN :from AND :to
    AND $scheduledCondition
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)
    $teamFilter
    $absFilter
    GROUP BY d.log_date
    ORDER BY d.log_date ASC";

    $stmt = $pdo->prepare($trendQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $trend = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $teamQuery = "SELECT 
        COALESCE(ot.name, d.group_name) as group_name,
        SUM(CASE WHEN $absentCondition THEN 1 ELSE 0 END) as absence_count,
        ROUND((SUM(CASE WHEN $absentCondition THEN 1 ELSE 0 END) * 100.0) / NULLIF(COUNT(*), 0), 2) as absence_rate,
        ROUND(SUM(CASE WHEN $absentCondition THEN GREATEST(TIME_TO_SEC($schedEnd) - TIME_TO_SEC($schedStart) - (" . elLunchMinutes() . " * 60), 0) ELSE 0 END) / 3600, 2) as lost_hours,
        COUNT(DISTINCT CASE WHEN $absentCondition THEN d.employee_id END) as unique_absentees,
        COUNT(*) as total_scheduled
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    " . elLunchJoin() . "
    $absJoins
    " . shiftPatternJoinSql() . "
    WHERE d.log_date BETWEEN :from AND :to
    AND $scheduledCondition
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)
    $teamFilter
    $absFilter
    GROUP BY group_name
    ORDER BY lost_hours DESC";

    $stmt = $pdo->prepare($teamQuery);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $teamStats = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'summary' => $summary,
        'trend' => $trend,
        'teamStats' => $teamStats,
        'globalScheduled' => $summary['total_scheduled'] ?? 0,
        'serverTime' => date('H:i:s'),
        'lastUpdate' => date('c'),
        'autoSynced' => $wasAutoSynced
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
