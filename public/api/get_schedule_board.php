<?php
/**
 * get_schedule_board.php
 * Read-only endpoint to fetch employee schedules for a week.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'ShiftSchedulePatterns.php';
require_once 'EmployeeLunchTimes.php';
require_once 'EmployeeRoster.php';
require_once 'ScheduleProjection.php';

try {
    session_start();
    $teamFilter = team_filter_sql('ota.team_id');

    $from = $_GET['from'] ?? null;
    $to = $_GET['to'] ?? null;

    // Shift Management's employee search reads three fields off this endpoint — id, name,
    // team — and was paying for the whole forecast engine to get them: seven queries, a
    // 42-day history scan per employee and an N x 7 payload, just to fill a dropdown.
    // `roster=1` answers with the roster alone and returns before any of that runs.
    //
    // It lives here rather than in an endpoint of its own on purpose: the freshness rule
    // in the roster query below and the team RBAC filter above are what decide who exists,
    // and the search has to list exactly the people the board lists. Two copies of those
    // rules would drift.
    $rosterOnly = !empty($_GET['roster']);

    // Roster mode answers two different questions, and the caller says which by whether it
    // sends a range.
    //
    // WITH a range (the Month view): who was on the roster during those dates. That has to
    // include people who have since left -- a month they worked is a month they belong in,
    // and the old rule ("synced within 3 days of the newest data in the table") answered
    // "who is here now" instead, so browsing back to August showed a September roster and
    // silently dropped everyone who left in between.
    //
    // WITHOUT one (Shift Management's employee search): who is here now, because that
    // search picks someone to schedule going forward.
    $rosterRanged = $rosterOnly && $from && $to;

    // Narrows every query to one person. The board asks for the whole roster, but the two
    // screens that render a single employee's week (Shift Management's editor and
    // Configuration > Scheduling > Forecast) were each pulling the entire board and then
    // discarding all but one row.
    $onlyEmployee = isset($_GET['employee_id']) ? (int) $_GET['employee_id'] : null;
    $employeeFilter = $onlyEmployee ? " AND d.employee_id = $onlyEmployee " : "";
    $employeeFilterBare = $onlyEmployee ? " AND employee_id = $onlyEmployee " : "";

    if (!$rosterOnly && (!$from || !$to)) {
        throw new Exception("From and To dates are required");
    }

    $today = date('Y-m-d');

    // Query to get all employees and their work shifts for the range
    // We group by employee and date to get a single row per day per person
    // Ordering by name and log_date for easier processing on frontend if needed,
    // although we'll pivot here.
    $sql = "SELECT
                d.employee_id,
                d.name,
                COALESCE(ot.name, d.group_name) as team_name,
                ota.team_id,
                ot.lunch_time as team_lunch,
                d.work_starts,
                d.work_ends,
                d.log_date
            FROM desktime_employee_data d
            LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
            LEFT JOIN org_teams ot ON ota.team_id = ot.id
            WHERE d.log_date BETWEEN :from AND :to
            $teamFilter
            $employeeFilter
            ORDER BY d.name ASC, d.log_date ASC";

    $rows = [];
    if (!$rosterOnly) {
        $stmt = $pdo->prepare($sql);
        $stmt->execute(['from' => $from, 'to' => $to]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // Who the roster holds. The shift projected onto their future days comes from
    // ScheduleProjection.php further down.
    //
    // The membership test comes from org_employees rather than from a scan of the activity
    // table: identity is what is being asked for here, and desktime_employee_data only ever
    // knew it by accident. $rosterRanged picks which of the two tests applies.
    ensureOrgEmployeesTable($pdo);

    $rosterMembership = $rosterRanged
        ? orgEmployeeInRangeFilter()
        : orgEmployeeCurrentFilter();

    // Both halves of the UNION below have to name the same collation -- see
    // rosterTextExpr(). Applied here too rather than only on the second branch, so the one
    // query shape serves ranged and non-ranged alike.
    $rosterName = rosterTextExpr('oe.name');
    $rosterGroup = rosterTextExpr('oe.group_name');

    // In ranged mode the roster is org_employees' stored window OR a worked day inside the
    // range, whichever finds the person. See orgEmployeeWorkedInRangeSql(): the second half
    // is what makes "let go in August, has August hours" appear in August's roster no matter
    // what the derived table says. Disjoint by construction, hence UNION ALL.
    $rosterWorkedBranch = $rosterRanged
        ? "
                UNION ALL
                " . orgEmployeeWorkedInRangeSql($employeeFilter)
        : '';

    $rosterSql = "SELECT
                r.employee_id,
                r.name,
                COALESCE(ot.name, r.group_name) as team_name,
                ota.team_id,
                ot.lunch_time as team_lunch
            FROM (
                SELECT oe.employee_id,
                       $rosterName AS name,
                       $rosterGroup AS group_name
                FROM org_employees oe
                WHERE $rosterMembership
                $employeeFilterBare
                $rosterWorkedBranch
            ) r
            LEFT JOIN org_team_assignments ota ON r.employee_id = ota.employee_id
            LEFT JOIN org_teams ot ON ota.team_id = ot.id
            WHERE 1=1
            $teamFilter";

    $rosterStmt = $pdo->prepare($rosterSql);
    $rosterStmt->execute($rosterRanged
        ? ['rosterFrom' => $from, 'rosterTo' => $to, 'workedFrom' => $from, 'workedTo' => $to]
        : []);
    $rosterRows = $rosterStmt->fetchAll(PDO::FETCH_ASSOC);

    // Per-employee lunch overrides (Employees > Teams > Assign Members > Lunch Time >
    // Employee Lunch Time). Carried as a map instead of a joined column because a board row
    // is one employee's whole week: the deduction can differ from column to column, so the
    // value each card needs is per weekday, not per row. `team_lunch` below stays the
    // fallback for every weekday the employee never customized.
    $lunchOverrides = fetchEmployeeLunchTimes($pdo, array_merge(
        array_column($rosterRows, 'employee_id'),
        array_column($rows, 'employee_id')
    ));

    // (object) so an employee with no overrides serializes as {} rather than [].
    $lunchMapFor = function ($employeeId) use ($lunchOverrides) {
        return (object) ($lunchOverrides[(int) $employeeId] ?? []);
    };

    // Everything past this point projects schedules. Roster mode wants none of it, and
    // answers with the same {id, name, team} shape the full response carries so a caller
    // can read either one with the same code.
    if ($rosterOnly) {
        $roster = array_map(function ($row) use ($lunchMapFor) {
            return [
                'id' => (int) $row['employee_id'],
                'name' => $row['name'],
                'team' => $row['team_name'],
                'lunch_time' => $row['team_lunch'] ?? 0,
                'lunch_by_weekday' => $lunchMapFor($row['employee_id'])
            ];
        }, $rosterRows);
        usort($roster, function ($a, $b) {
            return strcasecmp($a['name'], $b['name']);
        });

        echo json_encode(['success' => true, 'roster' => true, 'data' => $roster]);
        exit;
    }

    $rosterIds = array_column($rosterRows, 'employee_id');

    // The whole forecast chain -- weekday pattern, all-time shift, forecast override, Shift
    // Management versions and holidays -- lives in ScheduleProjection.php, shared with the
    // projected Run Rate so both read the same future shift.
    $projection = loadScheduleProjection($pdo, $rosterIds, $from, $to, $today);

    // Pivot data: [employee_id] => [name, team, schedules => [date => {start, end}]]
    $pivot = [];

    // Seed with the active roster first so employees still appear on weeks that are
    // entirely in the future (desktime_employee_data has zero rows for those dates).
    foreach ($rosterRows as $row) {
        $id = $row['employee_id'];
        $pivot[$id] = [
            'id' => $id,
            'name' => $row['name'],
            'team' => $row['team_name'],
            '_team_id' => $row['team_id'] !== null ? (int) $row['team_id'] : null,
            'lunch_time' => $row['team_lunch'] ?? 0,
            'lunch_by_weekday' => $lunchMapFor($row['employee_id']),
            'schedules' => []
        ];
    }

    foreach ($rows as $row) {
        $id = $row['employee_id'];
        if (!isset($pivot[$id])) {
            $pivot[$id] = [
                'id' => $id,
                'name' => $row['name'],
                'team' => $row['team_name'],
                'lunch_time' => $row['team_lunch'] ?? 0,
                'lunch_by_weekday' => $lunchMapFor($row['employee_id']),
                'schedules' => [],
                '_team_id' => $row['team_id'] !== null ? (int) $row['team_id'] : null
            ];
        }
        // `synced` marks a cell that came straight out of desktime_employee_data, which is
        // what the board's Type filter calls "Normal". Without it a cell carrying only a
        // holiday marker (added at the end of this file for a day with neither synced data
        // nor a projection) is indistinguishable from a real OFF day DeskTime reported.
        // The retroactive Shift Management pass below replaces the whole cell, so a day it
        // rewrites correctly stops being Normal and becomes a Manual Forecast.
        $pivot[$id]['schedules'][$row['log_date']] = [
            'start' => $row['work_starts'],
            'end' => $row['work_ends'],
            'synced' => true
        ];
    }

    // Days after today are the ones the projection fills; today and earlier are history.
    $requestPeriod = new DatePeriod(new DateTime($from), new DateInterval('P1D'), (new DateTime($to))->modify('+1 day'));
    $futureDates = [];
    $pastDates = [];
    foreach ($requestPeriod as $day) {
        $dateStr = $day->format('Y-m-d');
        if ($dateStr > $today) {
            $futureDates[] = $dateStr;
        } else {
            $pastDates[] = $dateStr;
        }
    }

    $shiftPatterns = $projection['shiftPatterns'];

    // Retroactive pass. A Shift Management version whose effective period reaches into days
    // the board has already recorded replaces the shift DeskTime reported for them — that is
    // the point of allowing a past Effective Start. Only the shift is replaced; nothing
    // touches the hours actually tracked.
    //
    // Deliberately separate from the tier chain below, which stays future-only: the forecast
    // override and the weekday pattern are projections and have no business rewriting
    // history, and running this pass on its own leaves the future precedence untouched.
    foreach ($pivot as $id => &$emp) {
        $versions = $shiftPatterns[(int) $id] ?? [];
        if (!$versions) {
            continue;
        }
        foreach ($pastDates as $dateStr) {
            $version = resolveShiftVersion($versions, $dateStr);
            if ($version === null) {
                continue;
            }
            $signature = $version['signature'];
            // Daylight Saving moves the version the same way the reports' SQL does.
            if (isset($projection['daylightSaving'][(int) $id])) {
                $signature = shiftSignatureBySeconds(
                    $signature,
                    daylightSavingShiftSeconds($dateStr, $version['effective_start'])
                );
            }
            if ($signature === 'OFF') {
                $emp['schedules'][$dateStr] = [
                    'start' => '00:00:00',
                    'end' => '00:00:00',
                    'predicted' => true,
                    'manualOverride' => true
                ];
            } else {
                [$start, $end] = explode('|', $signature);
                $emp['schedules'][$dateStr] = [
                    'start' => $start,
                    'end' => $end,
                    'predicted' => true,
                    'manualOverride' => true
                ];
            }
        }
    }
    unset($emp);

    // Future days with no synced record get the projected shift, flagged as a prediction
    // rather than a confirmed schedule. The shift is written unchanged even on a Custom
    // holiday: a Custom window is a deduction from the hours that count, not a change to the
    // person's schedule, so the hours maths subtracts it (shiftHours in ShiftCard.jsx).
    foreach ($pivot as $id => &$emp) {
        foreach ($futureDates as $dateStr) {
            if (isset($emp['schedules'][$dateStr])) {
                continue;
            }
            $shift = projectShift($projection, (int) $id, $emp['_team_id'] ?? null, $dateStr);
            if ($shift === null) {
                continue;
            }
            $cell = ['start' => $shift['start'], 'end' => $shift['end'], 'predicted' => true];
            if ($shift['manualOverride']) {
                $cell['manualOverride'] = true;
            }
            $emp['schedules'][$dateStr] = $cell;
        }
    }
    unset($emp);

    // Holiday markers for the entire range, not only the projected days. Each employee gets
    // the type their own team configured (Employees > Teams > Assign Members > Holidays),
    // so one date can read Non-Working for one person and Working for another. Attached
    // after every tier has run, so it labels whatever shift ended up on the day.
    $allDates = array_merge($pastDates, $futureDates);
    sort($allDates);

    foreach ($pivot as $id => &$emp) {
        foreach ($allDates as $dateStr) {
            $info = projectionHolidaysFor($projection, $emp['_team_id'] ?? null, $dateStr);
            if (empty($info)) {
                continue;
            }
            if (isset($emp['schedules'][$dateStr])) {
                $emp['schedules'][$dateStr]['holidays'] = $info;
            } else {
                // Nothing synced and nothing projected for that day: the cell would be a
                // bare OFF, so it still gets the marker rather than hiding the holiday.
                $emp['schedules'][$dateStr] = [
                    'start' => '00:00:00',
                    'end' => '00:00:00',
                    'holidays' => $info
                ];
            }
        }
        unset($emp['_team_id']);
    }
    unset($emp);

    echo json_encode([
        'success' => true,
        'from' => $from,
        'to' => $to,
        'data' => array_values($pivot)
    ]);

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
