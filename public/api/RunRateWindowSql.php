<?php
/**
 * RunRateWindowSql.php
 * SQL fragments shared by get_daily_run_rate.php (per day) and get_dashboard_stats.php
 * (MTD). Both resolve the same "working window" per employee-day and both have to clip it
 * the same way, so the expressions live here rather than being maintained twice.
 *
 * The working window is the shift the Run Rate already bills against:
 *   1. the employee's shift for that day, when it is valid, or
 *   2. the shift they usually work on that weekday (alias `sched`), when that weekday is
 *      one they work at all — a Sunday nobody is scheduled for gets nothing, or
 *   3. nothing — the day contributes 0 scheduled hours.
 *
 * A holiday of the Custom type (stored as the enum value `campaign_defined`) can carry a
 * time range for a team. On that date the range is discounted from the SCHEDULED side
 * only:
 *
 *   window 08:00-18:00, excluded 15:00-23:59  ->  kept 08:00-15:00
 *   scheduled hours  = 7   (was 10)
 *   tracked hours    = unchanged
 *
 * Tracked time is deliberately left alone. desktime_employee_data stores one total per day
 * with no record of when those seconds were accrued, so any split of it would be a guess;
 * the whole point of the Custom window is to lower what the team is measured against, not
 * to edit what they actually worked. The Run Rate for that day therefore rises, because
 * the same hours are compared against a shorter expected window.
 *
 * A Time Exception (Run Rate Report > Exceptions > Time Exceptions) is the other kind of
 * discount, and it cuts BOTH sides. It is a number of minutes swallowed at the START of the
 * window, every day, for a whole team or for one employee:
 *
 *   window 08:15-17:00, Time Exception 15 min  ->  billed window 08:30-17:00
 *   scheduled hours  = 8.5   (was 8.75)
 *   tracked hours    = minus whatever fell between 08:15 and 08:30
 *
 * Tracked time can be touched here — unlike the Custom window — because the day's start is
 * exactly the part of it we do have a timestamp for: `arrived`. The deduction is the slice
 * of the exception the employee was already present for, so someone who arrived at 08:25
 * loses 5 minutes and someone who arrived at 08:40 loses none. It is never a guess about
 * unobserved time, and it is capped so it can never push tracked hours below zero.
 *
 * Every function returns a SQL expression string; nothing here touches the database.
 */

// Lunch is deducted at the effective rate — the employee's own weekday override when they
// have one, the team's otherwise — so rrLunchHours() below borrows that resolution rather
// than re-deriving it. See EmployeeLunchTimes.php.
require_once __DIR__ . '/EmployeeLunchTimes.php';
// Which shift an employee-day is measured against. This file owns how that window is
// billed; WorkScheduleSql.php owns how it is found, so Attendance and Absenteeism resolve
// the same shift the Run Rate does.
require_once __DIR__ . '/WorkScheduleSql.php';

/**
 * Resolves one row per (employee, date) with the shift that Scheduling > Shift Management
 * has pinned for it, when a version covers that date.
 *
 * A schedule applied with a past Effective Start is authoritative over what DeskTime
 * recorded as the shift, so this outranks d.work_starts/d.work_ends below. Only the
 * SCHEDULED side is affected — tracked hours are never rewritten.
 *
 * Ranked rather than joined directly because several versions can cover the same date
 * (that is how re-applying supersedes an old schedule); the newest effective_start wins,
 * matching resolveShiftSignature() in ShiftSchedulePatterns.php. Without the ranking every
 * overlapping version would duplicate the employee's row and double each SUM().
 *
 * Binds the same :from / :to the surrounding query already uses.
 */
function rrShiftPatternJoin(): string
{
    return shiftPatternJoinSql();
}

/**
 * Resolves the shift to bill against on days DeskTime reported none for (work_starts
 * '00:00:00') and Shift Management has nothing pinned on either. It only ever supplies a
 * window; tracked time, holidays and exceptions are untouched by it.
 *
 * Resolved per (employee, weekday), not per employee. The per-employee version this
 * replaces handed the same shift to every unshifted day, and DeskTime writes a row for
 * every employee on every calendar day, weekends included — so a Saturday nobody was
 * scheduled for was billed a full working day, which is how the Run Rate came to disagree
 * with the Schedule Board's OFF cells.
 *
 * A weekday only earns a fallback when the employee demonstrably works it: at least half of
 * the days recorded for that weekday carry a real shift or some tracked time. Weekends fail
 * that test for everyone except the few who genuinely work them, while a weekday absence
 * still passes it — the evidence comes from the employee's other Tuesdays, not from the
 * Tuesday they were away — which is what keeps missing hours visible.
 *
 * The shift itself is that weekday's most used one, with the employee's most used shift
 * overall as a second tier, for the people DeskTime has never given a shift on a weekday
 * they nevertheless work. Both break ties on the latest date, so a schedule change takes
 * over as soon as it has matched the count of the one it replaces.
 *
 * Joined on WEEKDAY(), which numbers Monday 0 — the same numbering rrShiftPatternJoin()
 * shifts by one to index an ISO-keyed pattern.
 */
function rrFallbackScheduleJoin(): string
{
    return weekdayModeShiftJoinSql();
}

/**
 * The shift's own start, before any Time Exception — NULL when the day has no usable shift,
 * which now includes a day a Shift Management schedule marks OFF, so such a day contributes
 * 0 scheduled hours.
 *
 * Only rrWindowStart() and the Time Exception overlap need this unshifted value; everything
 * that bills against the window wants rrWindowStart() instead.
 */
function rrRawWindowStart(): string
{
    return shiftEffectiveStartSql('sched.work_starts');
}

/**
 * The start the Run Rate actually bills from: the shift's start pushed forward by the
 * team's (or the employee's) Time Exception, and never past the window's own end — a
 * team whose exception outruns its shift gets a zero-length window, not a negative one.
 *
 * NULL propagates: no shift means no window, exception or not.
 */
function rrWindowStart(): string
{
    return "LEAST(
                SEC_TO_TIME(TIME_TO_SEC(" . rrRawWindowStart() . ") + " . rrTimeExceptionSeconds() . "),
                " . rrWindowEnd() . "
            )";
}

/** The window's end, or NULL when the day has no usable shift. */
function rrWindowEnd(): string
{
    return shiftEffectiveEndSql('sched.work_ends');
}

/** Length of the working window in seconds; 0 when there is no window. */
function rrWindowSeconds(): string
{
    return "GREATEST(0, COALESCE(TIME_TO_SEC(" . rrWindowEnd() . ") - TIME_TO_SEC(" . rrWindowStart() . "), 0))";
}

/**
 * Seconds of the window that fall inside the team's excluded range for that date, via the
 * `cex` join built by rrCampaignExclusionJoin(). Zero when there is no exclusion, and the
 * plain intersection of the two intervals otherwise.
 */
function rrExcludedSeconds(): string
{
    return "GREATEST(0, COALESCE(
                LEAST(TIME_TO_SEC(" . rrWindowEnd() . "), TIME_TO_SEC(cex.ex_to))
                - GREATEST(TIME_TO_SEC(" . rrWindowStart() . "), TIME_TO_SEC(cex.ex_from))
            , 0))";
}

/** Seconds of the window that still count after the exclusion. */
function rrKeptSeconds(): string
{
    return "GREATEST(0, " . rrWindowSeconds() . " - " . rrExcludedSeconds() . ")";
}

/**
 * Scheduled hours for the day, with the team's Custom window already discounted. This is
 * the only figure a Custom window changes. Identical to the previous
 * TIME_TO_SEC(end)-TIME_TO_SEC(start) when no exclusion applies.
 */
function rrScheduledHours(): string
{
    return "(" . rrKeptSeconds() . " / 3600)";
}

/**
 * Length of the team's (or employee's) Time Exception in seconds. Zero when neither level
 * sets one, which is the default everywhere.
 *
 * Reads the per-employee override from the `rrte` join built by rrTimeExceptionJoin() and
 * falls back to the team's column; a missing row means "inherit the team", so an employee
 * who should have no exception while their team does needs an explicit 0 row.
 */
function rrTimeExceptionSeconds(): string
{
    return "(GREATEST(0, COALESCE(rrte.exception_minutes, ot.run_rate_time_exception_minutes, 0)) * 60)";
}

/**
 * Seconds of tracked time that fell inside the Time Exception, and so must come off the
 * actual hours.
 *
 * The exception runs from the shift's start to the billed start, and the employee only
 * accrued time in it from the moment they arrived — hence the GREATEST() on the lower
 * bound. Someone who arrived after the exception ended loses nothing (the subtraction goes
 * negative and GREATEST(0, ...) clamps it), and a day with no `arrived` at all is a day
 * with no tracked time to deduct from, so the COALESCE resolves it to 0.
 */
function rrTimeExceptionOverlapSeconds(): string
{
    return "GREATEST(0, COALESCE(
                TIME_TO_SEC(" . rrWindowStart() . ")
                - GREATEST(TIME_TO_SEC(" . rrRawWindowStart() . "), TIME_TO_SEC(TIME(d.arrived)))
            , 0))";
}

/**
 * Tracked seconds for the row, honouring the team's at_work_time / desktime_time choice and
 * net of any Time Exception. Floored at 0 — DeskTime's totals and the exception window are
 * independent measurements, so nothing guarantees the total is the larger of the two.
 */
function rrTrackedSeconds(): string
{
    return "GREATEST(0,
                CASE WHEN ot.run_rate_time_source = 'at_work_time'
                     THEN COALESCE(d.at_work_time, 0)
                     ELSE COALESCE(d.desktime_time, 0)
                END
                - " . rrTimeExceptionOverlapSeconds() . "
            )";
}

/**
 * Tracked hours for the whole group, exactly as DeskTime reported them. A Custom time
 * window never touches this side — it only shortens the scheduled window the hours are
 * measured against.
 *
 * Aggregates then divides, rather than dividing per row and summing: the two differ in the
 * fourth decimal on some employees, and this order is the one the figures were computed
 * with before this file existed.
 */
function rrActualHoursSum(): string
{
    return "(SUM(" . rrTrackedSeconds() . ") / 3600)";
}

/**
 * Lunch deduction for the row, unchanged in shape: nothing when the team has Exclude Lunch
 * off, otherwise the lunch that applies to this employee on this weekday as long as some
 * shift was found.
 *
 * "Applies" is the employee's own override for that weekday when Employee Lunch Time gave
 * them one, and the team's lunch otherwise — so a team of 60 with one person on 25 on
 * Wednesdays deducts 25 from that person's Wednesdays and 60 from everyone else's.
 * Requires elLunchJoin() in the surrounding query; without it `elt` is unresolved and the
 * query fails loudly rather than quietly billing the team default.
 *
 * Exclude Lunch stays a team-level switch: a team that does not deduct lunch at all
 * deducts none of it, per-employee overrides included.
 */
function rrLunchHours(): string
{
    return "CASE
                WHEN COALESCE(ot.exclude_lunch_from_run_rate, 0) = 0 THEN 0
                WHEN " . rrWindowStart() . " IS NOT NULL THEN " . elLunchMinutes() . " / 60.0
                ELSE 0
            END";
}

/**
 * Joins the per-employee Time Exception override, when the employee has one. At most one
 * row per employee (the table is unique on employee_id), so this can never duplicate an
 * employee's rows the way the holiday joins could.
 */
function rrTimeExceptionJoin(): string
{
    return "LEFT JOIN org_run_rate_time_exceptions rrte ON rrte.employee_id = d.employee_id";
}

/**
 * Joins one row per (team, date) carrying that team's Custom (`campaign_defined`) range.
 *
 * Grouped on purpose: org_holidays is unique per (country_code, holiday_date), so two
 * countries sharing a date would otherwise duplicate every employee row and double each
 * SUM(). When a team has ranges on two holidays that share a date, MIN/MAX merges them
 * into the single enclosing window.
 */
function rrCampaignExclusionJoin(): string
{
    return "LEFT JOIN (
                SELECT tht.team_id,
                       oh.holiday_date,
                       MIN(tht.exclude_from) AS ex_from,
                       MAX(tht.exclude_to) AS ex_to
                FROM org_team_holiday_types tht
                INNER JOIN org_holidays oh ON oh.id = tht.holiday_id
                WHERE tht.holiday_type = 'campaign_defined'
                  AND tht.exclude_from IS NOT NULL
                  AND tht.exclude_to IS NOT NULL
                GROUP BY tht.team_id, oh.holiday_date
            ) cex ON cex.team_id = ota.team_id AND cex.holiday_date = d.log_date";
}

/**
 * One row per (employee, team) with the Run Rate totals over :from..:to — the query behind
 * the Dashboard card, the Run Rate Report and the projection's "to date" half.
 *
 * Excluded employees (Employees Exceptions) are flagged in `is_excluded`, not removed, so
 * a caller can still show who was left out; every consumer filters them before summing.
 * Hours, scheduled hours and lunch are all scaled by the employee's Billable %.
 *
 * `$extraWhere` is appended to the WHERE as-is (a team or RBAC filter, starting with AND).
 */
function rrEmployeeTotalsSql(string $extraWhere = ''): string
{
    return "SELECT
        d.employee_id,
        d.name,
        COALESCE(ot.name, d.group_name) as team_name,
        MAX(rre.employee_id IS NOT NULL) as is_excluded,
        MAX(COALESCE(brp.billable_percentage, 100)) as billable_percentage,
        " . rrActualHoursSum() . "
            * (MAX(COALESCE(brp.billable_percentage, 100)) / 100) as mtd_actual,
        SUM(" . rrScheduledHours() . ")
            * (MAX(COALESCE(brp.billable_percentage, 100)) / 100) as mtd_scheduled,
        -- Scaled like the scheduled hours it is subtracted from; unscaled, a 50% billable
        -- employee lost a full lunch from half a shift and their Run Rate came out high.
        SUM(" . rrLunchHours() . ")
            * (MAX(COALESCE(brp.billable_percentage, 100)) / 100) as lunch_deduction_hours
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    LEFT JOIN org_run_rate_excluded_employees rre ON d.employee_id = rre.employee_id
    LEFT JOIN org_run_rate_excluded_days red ON red.team_id = ota.team_id AND red.excluded_date = d.log_date
    LEFT JOIN org_run_rate_excluded_employee_days red_emp ON red_emp.employee_id = d.employee_id AND red_emp.excluded_date = d.log_date
    LEFT JOIN org_run_rate_billable_percentage brp ON brp.employee_id = d.employee_id
    " . elLunchJoin() . "
    " . rrTimeExceptionJoin() . "
    " . rrCampaignExclusionJoin() . "
    " . rrShiftPatternJoin() . "
    " . rrFallbackScheduleJoin() . "
    WHERE d.log_date BETWEEN :from AND :to
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)
    AND red.id IS NULL
    AND red_emp.id IS NULL
    AND " . rrNonWorkingHolidayFilter() . "
    $extraWhere
    GROUP BY d.employee_id, d.name, team_name";
}

/**
 * One row per (employee, day, team) over :from..:to — the Run Rate Report's daily detail,
 * and the history the projection learns each employee's compliance rate from.
 *
 * Unlike rrEmployeeTotalsSql(), excluded employees are dropped outright. `$extraWhere` is
 * appended to the WHERE as-is; the caller adds any ORDER BY.
 */
function rrDailyRowsSql(string $extraWhere = ''): string
{
    return "SELECT
        d.employee_id,
        d.name,
        d.log_date,
        COALESCE(ot.name, d.group_name) as team_name,
        " . rrActualHoursSum() . "
            * (MAX(COALESCE(brp.billable_percentage, 100)) / 100) as daily_actual,
        SUM(" . rrScheduledHours() . ")
            * (MAX(COALESCE(brp.billable_percentage, 100)) / 100) as daily_scheduled,
        -- Scaled like the scheduled hours it is subtracted from; unscaled, a 50% billable
        -- employee lost a full lunch from half a shift and their Run Rate came out high.
        SUM(" . rrLunchHours() . ")
            * (MAX(COALESCE(brp.billable_percentage, 100)) / 100) as lunch_deduction_hours
    FROM desktime_employee_data d
    LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
    LEFT JOIN org_teams ot ON ota.team_id = ot.id
    LEFT JOIN org_groups og ON ot.group_id = og.id
    LEFT JOIN org_run_rate_excluded_employees rre ON d.employee_id = rre.employee_id
    LEFT JOIN org_run_rate_excluded_days red ON red.team_id = ota.team_id AND red.excluded_date = d.log_date
    LEFT JOIN org_run_rate_excluded_employee_days red_emp ON red_emp.employee_id = d.employee_id AND red_emp.excluded_date = d.log_date
    LEFT JOIN org_run_rate_billable_percentage brp ON brp.employee_id = d.employee_id
    " . elLunchJoin() . "
    " . rrTimeExceptionJoin() . "
    " . rrCampaignExclusionJoin() . "
    " . rrShiftPatternJoin() . "
    " . rrFallbackScheduleJoin() . "
    WHERE d.log_date BETWEEN :from AND :to
    AND (ot.is_visible IS NULL OR ot.is_visible = 1)
    AND (og.is_visible IS NULL OR og.is_visible = 1)
    AND rre.employee_id IS NULL
    AND red.id IS NULL
    AND red_emp.id IS NULL
    AND " . rrNonWorkingHolidayFilter() . "
    $extraWhere
    GROUP BY d.employee_id, d.name, d.log_date, team_name";
}

/**
 * The same billing as the SQL above, for a day that has not happened yet and so has no
 * desktime_employee_data row to run it on (see RunRateProjection.php). Keep the two in
 * step: each line mirrors the fragment named beside it.
 *
 * `$start`/`$end` are the projected shift ('HH:MM:SS'), null for no shift or an OFF day.
 * Returns scheduled and lunch hours, both already scaled by Billable %.
 *
 * @param array{from:string,to:string}|null $customWindow the team's Custom holiday window
 * @return array{scheduled:float,lunch:float}
 */
function rrBillProjectedDay(
    ?string $start,
    ?string $end,
    int $timeExceptionMinutes,
    ?array $customWindow,
    bool $excludeLunch,
    int $lunchMinutes,
    float $billablePercentage
): array {
    if ($start === null || $end === null) {
        return ['scheduled' => 0.0, 'lunch' => 0.0]; // no window: 0 hours, no lunch
    }
    $sec = function (string $time): int {
        [$h, $m, $s] = array_map('intval', explode(':', $time) + [0, 0, 0]);
        return $h * 3600 + $m * 60 + $s;
    };
    $rawStart = $sec($start);
    $windowEnd = $sec($end);
    // rrWindowStart(): pushed forward by the Time Exception, never past the end.
    $windowStart = min($rawStart + max(0, $timeExceptionMinutes) * 60, $windowEnd);
    // rrWindowSeconds()
    $window = max(0, $windowEnd - $windowStart);
    // rrExcludedSeconds(): the part of the window inside the Custom range.
    $excluded = $customWindow === null ? 0 : max(0,
        min($windowEnd, $sec($customWindow['to'])) - max($windowStart, $sec($customWindow['from'])));
    // rrKeptSeconds() / rrScheduledHours()
    $scheduled = max(0, $window - $excluded) / 3600;
    // rrLunchHours(): only for teams that deduct it, only on a day with a window.
    $lunch = $excludeLunch ? max(0, $lunchMinutes) / 60 : 0.0;

    $factor = $billablePercentage / 100;
    return ['scheduled' => $scheduled * $factor, 'lunch' => $lunch * $factor];
}

/**
 * Drops the whole day for a team when a holiday resolves to non_working for it. Per-team
 * override first, org-wide default otherwise, so the same date can count for one team and
 * not for another.
 *
 * NOT EXISTS rather than a JOIN for the same duplication reason as above.
 */
function rrNonWorkingHolidayFilter(): string
{
    return "NOT EXISTS (
                SELECT 1
                FROM org_holidays oh
                LEFT JOIN org_team_holiday_types tht
                       ON tht.holiday_id = oh.id AND tht.team_id = ota.team_id
                WHERE oh.holiday_date = d.log_date
                  AND COALESCE(tht.holiday_type, oh.holiday_type) = 'non_working'
            )";
}
