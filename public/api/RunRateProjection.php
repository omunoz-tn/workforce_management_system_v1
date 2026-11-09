<?php
/**
 * RunRateProjection.php
 * The Run Rate a period is expected to end on, for dates that have not happened yet.
 *
 * A period is split at `$asOf` (today, unless a backtest says otherwise):
 *
 *   Projected Run Rate = (actual to date + estimated actual) / (scheduled to date + projected scheduled)
 *
 *   - To date (from .. the day before $asOf): the real Run Rate, from the same query the
 *     report already runs (rrEmployeeTotalsSql()).
 *   - Projected scheduled ($asOf .. to): the shift the Schedule Board projects for each day
 *     (ScheduleProjection.php), billed with the Run Rate's own rules — Time Exception,
 *     Custom window, lunch, Billable %, excluded days — via rrBillProjectedDay().
 *   - Estimated actual: the employee's average real hours on that weekday (all their
 *     Mondays, all their Tuesdays...) over the last 12 weeks, absences left out. When too
 *     few of that weekday were worked, their scheduled hours times their overall rate
 *     (see complianceRates()).
 *
 * Today counts as projected, not real: its DeskTime total is still accumulating, and
 * counting a half-finished day as actual would drag every projection down in the morning.
 *
 * Used by get_run_rate_projection.php and by the weekly snapshot
 * (save_run_rate_projection_snapshot.php), so both give the same number.
 */

require_once __DIR__ . '/RunRateWindowSql.php';
require_once __DIR__ . '/ScheduleProjection.php';
require_once __DIR__ . '/EmployeeLunchTimes.php';
require_once __DIR__ . '/EmployeeRoster.php';

/** Days of history an employee's overall rate (their level) is learned from. */
const RR_PROJECTION_LOOKBACK_DAYS = 42;

/** Days of history the weekday averages are taken from: 12 of every weekday. */
const RR_PROJECTION_WEEKDAY_LOOKBACK_DAYS = 84;

/**
 * Worked days of a weekday an employee needs in the window for their own average of that
 * weekday to be used; with fewer, the day falls back to scheduled hours x overall rate.
 */
const RR_PROJECTION_WEEKDAY_MIN_DAYS = 2;

/**
 * A day of history counts half as much every this many days back. The last week weighs
 * roughly four times what the first week of the window does, so the projection follows how
 * someone works now, while an old absence still counts for something.
 */
const RR_PROJECTION_HALF_LIFE_DAYS = 14;

/**
 * How many (weighted) days of evidence a prior is worth when blending. An employee with
 * little history leans on their team; a weekday with few samples leans on the employee's
 * own figure. A regular employee has ~12 weighted days in the window, so their own figure
 * carries about 80%.
 */
const RR_PROJECTION_TEAM_PRIOR_DAYS = 3;

/** Bounds on a compliance rate, so one odd week cannot project 3x the hours. */
const RR_PROJECTION_RATE_MIN = 0.0;
const RR_PROJECTION_RATE_MAX = 1.5;

/** Working days of history behind a "high" / "medium" confidence employee. */
const RR_PROJECTION_HIGH_CONFIDENCE_DAYS = 15;
const RR_PROJECTION_MEDIUM_CONFIDENCE_DAYS = 5;

function rrProjectionDates(string $from, string $to): array
{
    $dates = [];
    if ($from > $to) {
        return $dates;
    }
    $period = new DatePeriod(new DateTime($from), new DateInterval('P1D'), (new DateTime($to))->modify('+1 day'));
    foreach ($period as $day) {
        $dates[] = $day->format('Y-m-d');
    }
    return $dates;
}

function rrProjectionClampRate(float $rate): float
{
    return max(RR_PROJECTION_RATE_MIN, min(RR_PROJECTION_RATE_MAX, $rate));
}

/**
 * What each employee is expected to work, learned from the Run Rate's own daily rows.
 *
 *   - Weekday average: the employee's average real hours on each weekday over the last
 *     RR_PROJECTION_WEEKDAY_LOOKBACK_DAYS (all their Mondays, all their Tuesdays...). A
 *     projected day gets that average. If the day's scheduled hours differ from what that
 *     weekday usually had (a half-day holiday, a schedule change), the average is scaled
 *     by the same proportion. Used when the employee worked at least
 *     RR_PROJECTION_WEEKDAY_MIN_DAYS of that weekday.
 *   - Fallback rate: actual / scheduled hours over the last RR_PROJECTION_LOOKBACK_DAYS,
 *     recency-weighted (RR_PROJECTION_HALF_LIFE_DAYS), blended toward the team, and the
 *     team toward the organization, when the employee's own evidence is thin. A weekday
 *     with too few worked days gets scheduled hours x this rate.
 *
 * Absences are left out: a scheduled day with no tracked time at all says nothing about
 * the days to come. A week of vacation or a leave projected the person far below how they
 * really work once back, so only days with tracked time count. A known future absence is
 * entered as an excluded employee day, which drops the day from the projection.
 *
 * Days with no scheduled hours say nothing about meeting a schedule and are skipped.
 * Someone with no worked day in the level window (on leave the whole time, or new) takes
 * their team's rate.
 *
 * Returned as closures over the tallies:
 *   estimateFor(employeeId, teamName, isoWeekday, scheduledHours) -> float hours
 *   historyDays(employeeId)             -> int  (days worked in the level window)
 *   employeeRate(employeeId, teamName)  -> float
 * plus weekdayHistory: team -> ISO weekday -> [actual, scheduled] hours over the weekday
 * window, absences included (the real Run Rate by weekday, for the recommendations).
 */
function complianceRates(PDO $pdo, string $asOf, string $extraWhere, array $extraParams): array
{
    $levelFrom = date('Y-m-d', strtotime($asOf . ' -' . RR_PROJECTION_LOOKBACK_DAYS . ' days'));
    $lookbackDays = max(RR_PROJECTION_LOOKBACK_DAYS, RR_PROJECTION_WEEKDAY_LOOKBACK_DAYS);
    $lookbackFrom = date('Y-m-d', strtotime($asOf . ' -' . $lookbackDays . ' days'));
    $lookbackTo = date('Y-m-d', strtotime($asOf . ' -1 day'));

    $stmt = $pdo->prepare(rrDailyRowsSql($extraWhere));
    $stmt->execute(['from' => $lookbackFrom, 'to' => $lookbackTo] + $extraParams);

    // Level tally: [weighted actual hours, weighted scheduled hours, weighted days, days].
    $tally = ['emp' => [], 'team' => [], 'all' => [0.0, 0.0, 0.0, 0]];
    // Per employee and ISO weekday, worked days only: [actual hours, scheduled hours, days].
    $weekdayTally = [];
    // The real Run Rate per team and weekday, absences included: [actual, scheduled].
    $weekdayHistory = [];
    $seenDay = [];  // an employee on two teams yields two rows per day; count the day once
    $asOfTs = strtotime($asOf);

    $add = function (?array $t, float $w, float $actual, float $adj): array {
        $t = $t ?? [0.0, 0.0, 0.0, 0];
        return [$t[0] + $w * $actual, $t[1] + $w * $adj, $t[2] + $w, $t[3] + 1];
    };

    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $adj = max(0.0, (float) $row['daily_scheduled'] - (float) $row['lunch_deduction_hours']);
        $actual = (float) $row['daily_actual'];
        if ($adj > 0) {
            $histWd = projectionIsoWeekday($row['log_date']);
            $histTeam = (string) $row['team_name'];
            $weekdayHistory[$histTeam][$histWd][0] = ($weekdayHistory[$histTeam][$histWd][0] ?? 0.0) + $actual;
            $weekdayHistory[$histTeam][$histWd][1] = ($weekdayHistory[$histTeam][$histWd][1] ?? 0.0) + $adj;
        }
        if ($adj <= 0 || $actual <= 0) {
            continue;
        }
        $id = (int) $row['employee_id'];
        $inLevel = $row['log_date'] >= $levelFrom;
        $ageDays = max(1, (int) round(($asOfTs - strtotime($row['log_date'])) / 86400));
        $w = pow(0.5, $ageDays / RR_PROJECTION_HALF_LIFE_DAYS);
        $teamName = (string) $row['team_name'];

        if ($inLevel) {
            $tally['team'][$teamName] = $add($tally['team'][$teamName] ?? null, $w, $actual, $adj);
            $tally['all'] = $add($tally['all'], $w, $actual, $adj);
        }

        $dayKey = $id . '|' . $row['log_date'];
        if (isset($seenDay[$dayKey])) {
            continue;
        }
        $seenDay[$dayKey] = true;

        if ($inLevel) {
            $tally['emp'][$id] = $add($tally['emp'][$id] ?? null, $w, $actual, $adj);
        }
        $wd = projectionIsoWeekday($row['log_date']);
        $t = $weekdayTally[$id][$wd] ?? [0.0, 0.0, 0];
        $weekdayTally[$id][$wd] = [$t[0] + $actual, $t[1] + $adj, $t[2] + 1];
    }

    // (evidence * own + weight * prior) / (evidence + weight), or the prior alone.
    $blend = function (?float $own, float $evidence, float $prior, float $priorWeight): float {
        if ($own === null || $evidence <= 0) {
            return $prior;
        }
        return ($evidence * $own + $priorWeight * $prior) / ($evidence + $priorWeight);
    };
    $ratio = function (?array $t): ?float {
        return $t && $t[1] > 0 ? rrProjectionClampRate($t[0] / $t[1]) : null;
    };

    // With no history at all there is nothing to learn from; assume the schedule is met
    // and let the confidence figure say how little that is worth.
    $globalRate = $ratio($tally['all']) ?? 1.0;

    $teamRate = function (string $team) use ($tally, $ratio, $blend, $globalRate): float {
        $t = $tally['team'][$team] ?? null;
        return $blend($ratio($t), $t[2] ?? 0.0, $globalRate, RR_PROJECTION_TEAM_PRIOR_DAYS);
    };
    $employeeRate = function (int $id, string $team) use ($tally, $ratio, $blend, $teamRate): float {
        $t = $tally['emp'][$id] ?? null;
        return rrProjectionClampRate($blend($ratio($t), $t[2] ?? 0.0, $teamRate($team), RR_PROJECTION_TEAM_PRIOR_DAYS));
    };

    // The weekday's average hours, scaled when the day's schedule differs from that
    // weekday's usual one: (actual / days) x (scheduled / (weekday scheduled / days)).
    $estimateFor = function (int $id, string $team, int $wd, float $scheduled) use ($weekdayTally, $employeeRate): float {
        $t = $weekdayTally[$id][$wd] ?? null;
        if ($t && $t[2] >= RR_PROJECTION_WEEKDAY_MIN_DAYS && $t[1] > 0) {
            $avgActual = $t[0] / $t[2];
            $avgScheduled = $t[1] / $t[2];
            return $avgActual * ($scheduled / $avgScheduled);
        }
        return $scheduled * $employeeRate($id, $team);
    };
    $historyDays = function (int $id) use ($tally): int {
        return (int) ($tally['emp'][$id][3] ?? 0);
    };

    return compact('estimateFor', 'historyDays', 'employeeRate', 'weekdayHistory');
}

/**
 * @param array{
 *   asOf?: string,        first projected day; defaults to today
 *   extraWhere?: string,  RBAC fragment on ota.team_id, starting with AND
 *   team?: ?string,       one team by name
 *   daily?: bool,         include one row per projected employee-day
 *   compare?: bool        include the real totals of the projected days (backtests)
 * } $opts
 */
function computeRunRateProjection(PDO $pdo, string $from, string $to, array $opts = []): array
{
    $today = date('Y-m-d');
    $asOf = $opts['asOf'] ?? $today;
    $isLive = $asOf >= $today;
    $extraWhere = $opts['extraWhere'] ?? '';
    $teamName = $opts['team'] ?? null;

    $yesterdayOfAsOf = date('Y-m-d', strtotime($asOf . ' -1 day'));
    $realTo = min($to, $yesterdayOfAsOf);
    $projFrom = max($from, $asOf);

    $rows = [];
    $keyOf = function ($employeeId, $teamName) {
        return (int) $employeeId . '|' . $teamName;
    };
    $blankRow = function ($employeeId, $name, $team) {
        return [
            'employee_id' => (int) $employeeId,
            'name' => $name,
            'team_name' => $team,
            'is_excluded' => 0,
            'billable_percentage' => 100.0,
            'actual_to_date' => 0.0,
            'scheduled_to_date' => 0.0,
            'lunch_to_date' => 0.0,
            'projected_scheduled' => 0.0,
            'projected_lunch' => 0.0,
            'projected_actual' => 0.0,
            'projected_days' => 0,
            'compliance_rate' => null,
            'history_days' => 0,
            'confidence' => null,
        ];
    };

    $teamParams = [];
    $realTeamCondition = '';
    if ($teamName !== null && $teamName !== '') {
        $realTeamCondition = " AND (ot.name = :team OR d.group_name = :team)";
        $teamParams['team'] = $teamName;
    }

    // ── To date: the real Run Rate ─────────────────────────────────────────────
    if ($from <= $realTo) {
        $stmt = $pdo->prepare(rrEmployeeTotalsSql($extraWhere . $realTeamCondition));
        $stmt->execute(['from' => $from, 'to' => $realTo] + $teamParams);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $key = $keyOf($r['employee_id'], $r['team_name']);
            $rows[$key] = $rows[$key] ?? $blankRow($r['employee_id'], $r['name'], $r['team_name']);
            $rows[$key]['is_excluded'] = (int) $r['is_excluded'];
            $rows[$key]['billable_percentage'] = (float) $r['billable_percentage'];
            $rows[$key]['actual_to_date'] = (float) $r['mtd_actual'];
            $rows[$key]['scheduled_to_date'] = (float) $r['mtd_scheduled'];
            $rows[$key]['lunch_to_date'] = (float) $r['lunch_deduction_hours'];
        }
    }

    $teamDates = [];
    $daily = [];
    $weekdayHistoryOut = [];

    // ── From $asOf on: projected ───────────────────────────────────────────────
    if ($projFrom <= $to) {
        ensureOrgEmployeesTable($pdo);

        // Who is on the roster when the projection is made. Live, that is the board's own
        // "who is here now"; a backtest asks who was active on its $asOf instead — someone
        // who left later was still expected to work when that projection would have run.
        $membership = $isLive
            ? orgEmployeeCurrentFilter()
            : "oe.first_seen < :asOf AND oe.last_seen >= DATE_SUB(:asOfWindow, INTERVAL " . (EMPLOYEE_ACTIVE_WINDOW_DAYS + 1) . " DAY)";
        $rosterParams = $isLive ? [] : ['asOf' => $asOf, 'asOfWindow' => $asOf];
        $rosterTeamCondition = '';
        if (isset($teamParams['team'])) {
            $rosterTeamCondition = " AND (ot.name = :team OR oe.group_name = :team)";
            $rosterParams['team'] = $teamParams['team'];
        }

        $stmt = $pdo->prepare("
            SELECT oe.employee_id,
                   oe.name,
                   COALESCE(ot.name, oe.group_name) AS team_name,
                   ota.team_id,
                   ot.lunch_time AS team_lunch,
                   COALESCE(ot.exclude_lunch_from_run_rate, 0) AS exclude_lunch,
                   COALESCE(rrte.exception_minutes, ot.run_rate_time_exception_minutes, 0) AS exception_minutes,
                   rre.employee_id IS NOT NULL AS is_excluded,
                   COALESCE(brp.billable_percentage, 100) AS billable_percentage
            FROM org_employees oe
            LEFT JOIN org_team_assignments ota ON ota.employee_id = oe.employee_id
            LEFT JOIN org_teams ot ON ot.id = ota.team_id
            LEFT JOIN org_groups og ON og.id = ot.group_id
            LEFT JOIN org_run_rate_excluded_employees rre ON rre.employee_id = oe.employee_id
            LEFT JOIN org_run_rate_billable_percentage brp ON brp.employee_id = oe.employee_id
            LEFT JOIN org_run_rate_time_exceptions rrte ON rrte.employee_id = oe.employee_id
            WHERE $membership
              AND (ot.is_visible IS NULL OR ot.is_visible = 1)
              AND (og.is_visible IS NULL OR og.is_visible = 1)
              $extraWhere
              $rosterTeamCondition
        ");
        $stmt->execute($rosterParams);
        $roster = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $employeeIds = array_map('intval', array_column($roster, 'employee_id'));
        $ctx = loadScheduleProjection($pdo, $employeeIds, $projFrom, $to, $asOf);
        $lunchOverrides = fetchEmployeeLunchTimes($pdo, $employeeIds);

        $excludedTeamDays = [];
        $stmt = $pdo->prepare("SELECT team_id, excluded_date FROM org_run_rate_excluded_days WHERE excluded_date BETWEEN :from AND :to");
        $stmt->execute(['from' => $projFrom, 'to' => $to]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $excludedTeamDays[(int) $r['team_id']][$r['excluded_date']] = true;
        }
        $excludedEmployeeDays = [];
        $stmt = $pdo->prepare("SELECT employee_id, excluded_date FROM org_run_rate_excluded_employee_days WHERE excluded_date BETWEEN :from AND :to");
        $stmt->execute(['from' => $projFrom, 'to' => $to]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $excludedEmployeeDays[(int) $r['employee_id']][$r['excluded_date']] = true;
        }

        // RBAC applies to the history too, so a restricted user's team rates are not
        // learned from teams they cannot see.
        $rates = complianceRates($pdo, $asOf, $extraWhere, []);
        foreach ($rates['weekdayHistory'] as $histTeam => $byWd) {
            foreach ($byWd as $histWd => [$histActual, $histScheduled]) {
                $weekdayHistoryOut[$histTeam][$histWd] = [
                    'actual' => round($histActual, 2),
                    'scheduled' => round($histScheduled, 2),
                ];
            }
        }
        $projDates = rrProjectionDates($projFrom, $to);

        foreach ($roster as $r) {
            $id = (int) $r['employee_id'];
            $teamId = $r['team_id'] !== null ? (int) $r['team_id'] : null;
            $team = (string) $r['team_name'];
            $billable = (float) $r['billable_percentage'];
            $excluded = (bool) $r['is_excluded'];

            $key = $keyOf($id, $team);
            $rows[$key] = $rows[$key] ?? $blankRow($id, $r['name'], $team);
            $row = &$rows[$key];
            $row['is_excluded'] = (int) $excluded;
            $row['billable_percentage'] = $billable;
            $row['compliance_rate'] = round($rates['employeeRate']($id, $team), 4);
            $row['history_days'] = $rates['historyDays']($id);
            $row['confidence'] = $row['history_days'] >= RR_PROJECTION_HIGH_CONFIDENCE_DAYS ? 'high'
                : ($row['history_days'] >= RR_PROJECTION_MEDIUM_CONFIDENCE_DAYS ? 'medium' : 'low');

            foreach ($projDates as $date) {
                // Days the report drops entirely: excluded for the team or the employee, or
                // a Non-Working holiday for the team (projectShift() would make it OFF too).
                if (($teamId !== null && isset($excludedTeamDays[$teamId][$date]))
                    || isset($excludedEmployeeDays[$id][$date])
                    || projectionIsNonWorking($ctx, $teamId, $date)) {
                    continue;
                }

                $shift = projectShift($ctx, $id, $teamId, $date);
                $isOff = $shift === null || ($shift['start'] === '00:00:00' && $shift['end'] === '00:00:00');
                $wd = projectionIsoWeekday($date);
                $lunchMinutes = (int) ($lunchOverrides[$id][$wd] ?? $r['team_lunch'] ?? 0);

                $bill = rrBillProjectedDay(
                    $isOff ? null : $shift['start'],
                    $isOff ? null : $shift['end'],
                    (int) $r['exception_minutes'],
                    projectionCustomWindow($ctx, $teamId, $date),
                    (bool) $r['exclude_lunch'],
                    $lunchMinutes,
                    $billable
                );
                $adjusted = max(0.0, $bill['scheduled'] - $bill['lunch']);
                if ($bill['scheduled'] <= 0 && $bill['lunch'] <= 0) {
                    continue;
                }
                $estimated = $adjusted > 0 ? $rates['estimateFor']($id, $team, $wd, $adjusted) : 0.0;
                $rate = $adjusted > 0 ? $estimated / $adjusted : 0.0;

                $row['projected_scheduled'] += $bill['scheduled'];
                $row['projected_lunch'] += $bill['lunch'];
                $row['projected_actual'] += $estimated;
                $row['projected_days'] += $adjusted > 0 ? 1 : 0;

                if (!$excluded && $adjusted > 0) {
                    $teamDates[$team][$date] = true;
                }
                if (!empty($opts['daily'])) {
                    $daily[] = [
                        'employee_id' => $id,
                        'name' => $r['name'],
                        'team_name' => $team,
                        'log_date' => $date,
                        'daily_actual' => round($estimated, 4),
                        'daily_scheduled' => round($bill['scheduled'], 4),
                        'lunch_deduction_hours' => round($bill['lunch'], 4),
                        'shift_start' => $shift['start'],
                        'shift_end' => $shift['end'],
                        'manual_schedule' => (bool) $shift['manualOverride'],
                        'compliance_rate' => round($rate, 4),
                        'is_excluded' => (int) $excluded,
                        'projected' => true,
                    ];
                }
            }
            unset($row);
        }
    }

    // ── Backtest: what really happened on the projected days ───────────────────
    if (!empty($opts['compare']) && $projFrom <= $to) {
        $compareTo = min($to, date('Y-m-d', strtotime($today . ' -1 day')));
        if ($projFrom <= $compareTo) {
            $stmt = $pdo->prepare(rrEmployeeTotalsSql($extraWhere . $realTeamCondition));
            $stmt->execute(['from' => $projFrom, 'to' => $compareTo] + $teamParams);
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $key = $keyOf($r['employee_id'], $r['team_name']);
                $rows[$key] = $rows[$key] ?? $blankRow($r['employee_id'], $r['name'], $r['team_name']);
                $rows[$key]['is_excluded'] = max($rows[$key]['is_excluded'], (int) $r['is_excluded']);
                $rows[$key]['real_actual'] = (float) $r['mtd_actual'];
                $rows[$key]['real_scheduled'] = (float) $r['mtd_scheduled'];
                $rows[$key]['real_lunch'] = (float) $r['lunch_deduction_hours'];
            }
        }
    }

    foreach ($rows as &$row) {
        foreach (['projected_scheduled', 'projected_lunch', 'projected_actual'] as $field) {
            $row[$field] = round($row[$field], 4);
        }
    }
    unset($row);

    $teamDatesOut = [];
    foreach ($teamDates as $team => $dates) {
        $list = array_keys($dates);
        sort($list);
        $teamDatesOut[$team] = $list;
    }

    $result = [
        'from' => $from,
        'to' => $to,
        'as_of' => $asOf,
        'actual_through' => $from <= $realTo ? $realTo : null,
        'projected_from' => $projFrom <= $to ? $projFrom : null,
        'data' => array_values($rows),
        'team_dates' => (object) $teamDatesOut,
        // Real Run Rate by team and ISO weekday (1 = Monday) over the last
        // RR_PROJECTION_WEEKDAY_LOOKBACK_DAYS, absences included.
        'weekday_history' => (object) $weekdayHistoryOut,
        'weekday_history_days' => RR_PROJECTION_WEEKDAY_LOOKBACK_DAYS,
    ];
    if (!empty($opts['daily'])) {
        $result['daily'] = $daily;
    }
    return $result;
}
