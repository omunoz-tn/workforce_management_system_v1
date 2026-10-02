<?php
/**
 * get_attendance_details.php
 *
 * Row-level attendance failures: one row per employee/day where the employee was
 * scheduled and never logged in. Same absence rule as get_absenteeism_details.php,
 * but this endpoint returns a flat list instead of aggregates -- the report only
 * lists who broke the rule, so teams and days with full attendance never appear.
 *
 * Holidays are deliberately not consulted. The only question this report asks is
 * whether a scheduled employee put in hours that day.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'sync_desktime_core.php';
require_once 'EmployeeLunchTimes.php';
require_once 'WorkScheduleSql.php';

try {
    session_start();
    $teamFilter = team_filter_sql('ota.team_id');

    $fromDate = isset($_GET['from']) ? $_GET['from'] : date('Y-m-d');
    $toDate = isset($_GET['to']) ? $_GET['to'] : date('Y-m-d');
    $today = date('Y-m-d');

    // Same smart refresh as the absenteeism report: a stale snapshot of today reads
    // as a floor full of no-shows.
    $wasAutoSynced = false;
    if ($fromDate <= $today && $toDate >= $today) {
        $syncCheckQuery = "SELECT MAX(updated_at) as last_sync FROM desktime_employee_data WHERE log_date = :log_date";
        $stmt = $pdo->prepare($syncCheckQuery);
        $stmt->execute(['log_date' => $today]);
        $syncInfo = $stmt->fetch(PDO::FETCH_ASSOC);

        $lastSync = $syncInfo['last_sync'] ? strtotime($syncInfo['last_sync']) : 0;
        $syncThreshold = 600; // 10 minutes

        if ((time() - $lastSync) > $syncThreshold) {
            syncDeskTime($pdo, $env);
            $wasAutoSynced = true;
        }
    }

    // The shift the employee was expected on, resolved the same way every other report
    // resolves it: Shift Management's schedule first, DeskTime's own window second, nothing
    // third (see WorkScheduleSql.php).
    //
    // Reading the schedule through this instead of straight off d.work_starts is what lets
    // a no-show survive the employee leaving DeskTime. DeskTime stops answering with a
    // schedule for someone it no longer holds, so a re-sync of a past range used to blank
    // the shift out and take the absence with it -- the day still had the row, but nothing
    // left on it said the person had been expected. Our own Shift Management record does
    // not evaporate when they go.
    $schedStart = shiftEffectiveStartSql();
    $schedEnd = shiftEffectiveEndSql();

    // Offline, no arrival recorded, a shift on the books, and that shift has already
    // started. Identical to the absenteeism definition so both reports agree.
    $absentCondition = "d.is_online = 0 AND d.arrived IS NULL AND $schedStart IS NOT NULL AND $schedEnd > $schedStart AND (
        (d.log_date < CURDATE()) OR (d.log_date = CURDATE() AND CURTIME() > $schedStart)
    )";

    // GROUP BY employee/day on purpose: org_team_assignments fans out when an employee
    // belongs to more than one team, which would list the same absence twice.
    $query = "SELECT
        d.employee_id,
        MIN(d.name) as name,
        d.log_date,
        MIN($schedStart) as work_starts,
        MIN($schedEnd) as work_ends,
        COALESCE(MIN(ot.name), NULLIF(MIN(d.group_name), ''), 'Unassigned') as team_name,
        ROUND(GREATEST(
            TIME_TO_SEC(MIN($schedEnd)) - TIME_TO_SEC(MIN($schedStart)) - (" . elLunchMinutesGrouped() . " * 60),
        0) / 3600, 2) as lost_hours
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    " . elLunchJoin() . "
    " . shiftPatternJoinSql() . "
    WHERE d.log_date BETWEEN :from AND :to
    AND $absentCondition
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)
    $teamFilter
    GROUP BY d.employee_id, d.log_date
    ORDER BY d.log_date DESC, name ASC";

    $stmt = $pdo->prepare($query);
    $stmt->execute(['from' => $fromDate, 'to' => $toDate]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $rows,
        'from' => $fromDate,
        'to' => $toDate,
        'autoSynced' => $wasAutoSynced,
        'lastUpdate' => date('c')
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
