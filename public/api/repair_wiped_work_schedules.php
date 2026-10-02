<?php
/**
 * repair_wiped_work_schedules.php
 *
 * Restores the work schedules a re-sync erased. DeskTime answers with an empty window for
 * anyone it no longer holds a schedule for, and until the guard in sync_desktime_core.php
 * that empty window was written straight over the correct one -- so re-syncing a past range
 * after someone was taken out of DeskTime blanked their shifts, and every absence on those
 * days disappeared with them (an absence is a scheduled shift nobody showed up for; with no
 * shift on the row there is nothing to have missed).
 *
 * The guard stops the bleeding. This repairs what was already lost.
 *
 * A damaged row is one carrying the weekday sentinel '00:00:00'-'23:59:59'. Days DeskTime
 * genuinely holds as non-working are '00:00:00'-'00:00:00' or NULL and are left alone. The
 * replacement is the shift the employee usually works on that weekday, from
 * weekdayModeShiftSql() -- the same reconstruction the Run Rate already bills against, so
 * this writes nothing the Run Rate was not already assuming. That derivation only answers
 * for weekdays the employee demonstrably works, so a row it has no answer for stays as it
 * is.
 *
 * DRY RUN BY DEFAULT. Reports what it would change and writes nothing until called with
 * `?apply=1`. Optional `from` / `to` narrow it to a date range.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'WorkScheduleSql.php';

set_time_limit(600);

try {
    $apply = !empty($_GET['apply']);
    $from = $_GET['from'] ?? null;
    $to = $_GET['to'] ?? null;

    foreach (['from' => $from, 'to' => $to] as $label => $value) {
        if ($value !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            throw new Exception("Invalid $label date: $value");
        }
    }

    $dateBound = '';
    $params = [];
    if ($from !== null && $to !== null) {
        $dateBound = ' AND d.log_date BETWEEN :from AND :to';
        $params = ['from' => $from, 'to' => $to];
    }

    // Materialised first because MySQL refuses to update a table a subquery in the same
    // statement selects from, and weekdayModeShiftSql() reads desktime_employee_data.
    $pdo->exec("DROP TEMPORARY TABLE IF EXISTS tmp_weekday_shift");
    $pdo->exec("CREATE TEMPORARY TABLE tmp_weekday_shift (
                    employee_id BIGINT NOT NULL,
                    weekday TINYINT NOT NULL,
                    work_starts TIME NULL,
                    work_ends TIME NULL,
                    PRIMARY KEY (employee_id, weekday)
                ) AS " . weekdayModeShiftSql());

    // The rows this would touch: a weekday sentinel, for an (employee, weekday) the
    // reconstruction has an answer for.
    $target = "FROM desktime_employee_data d
               INNER JOIN tmp_weekday_shift w
                       ON w.employee_id = d.employee_id
                      AND w.weekday = WEEKDAY(d.log_date)
               WHERE d.work_starts = '00:00:00'
                 AND d.work_ends = '23:59:59'
                 AND w.work_starts IS NOT NULL
                 AND w.work_ends IS NOT NULL
                 $dateBound";

    $stmt = $pdo->prepare("SELECT COUNT(*) AS rows_affected,
                                  COUNT(DISTINCT d.employee_id) AS employees,
                                  MIN(d.log_date) AS earliest,
                                  MAX(d.log_date) AS latest,
                                  SUM(d.arrived IS NULL) AS rows_with_no_arrival
                           $target");
    $stmt->execute($params);
    $scope = $stmt->fetch(PDO::FETCH_ASSOC);

    $stmt = $pdo->prepare("SELECT d.employee_id, d.name, d.log_date,
                                  d.work_starts AS current_start, d.work_ends AS current_end,
                                  w.work_starts AS repaired_start, w.work_ends AS repaired_end,
                                  d.arrived
                           $target
                           ORDER BY d.log_date DESC, d.name ASC
                           LIMIT 20");
    $stmt->execute($params);
    $sample = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $written = 0;
    if ($apply) {
        // is_late is recomputed rather than left alone: it was derived from the blanked
        // start, so every one of these rows currently claims the employee was on time.
        $stmt = $pdo->prepare("UPDATE desktime_employee_data d
                               INNER JOIN tmp_weekday_shift w
                                       ON w.employee_id = d.employee_id
                                      AND w.weekday = WEEKDAY(d.log_date)
                               SET d.work_starts = w.work_starts,
                                   d.work_ends = w.work_ends,
                                   d.is_late = (d.arrived IS NOT NULL AND TIME(d.arrived) > w.work_starts)
                               WHERE d.work_starts = '00:00:00'
                                 AND d.work_ends = '23:59:59'
                                 AND w.work_starts IS NOT NULL
                                 AND w.work_ends IS NOT NULL
                                 $dateBound");
        $stmt->execute($params);
        $written = $stmt->rowCount();
    }

    $pdo->exec("DROP TEMPORARY TABLE IF EXISTS tmp_weekday_shift");

    echo json_encode([
        'success' => true,
        'mode' => $apply ? 'applied' : 'dry-run',
        'message' => $apply
            ? "$written row(s) repaired."
            : "Dry run: nothing written. Re-run with &apply=1 to write these changes.",
        'range' => $from !== null && $to !== null ? "$from .. $to" : 'all dates',
        'rows_affected' => (int) $scope['rows_affected'],
        'rows_written' => $written,
        'employees' => (int) $scope['employees'],
        // How many repaired rows have no arrival: these are the absences that were invisible
        // and will now be counted by Attendance and Absenteeism.
        'absences_recovered' => (int) $scope['rows_with_no_arrival'],
        'earliest' => $scope['earliest'],
        'latest' => $scope['latest'],
        'sample' => $sample
    ], JSON_PRETTY_PRINT);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()], JSON_PRETTY_PRINT);
}
