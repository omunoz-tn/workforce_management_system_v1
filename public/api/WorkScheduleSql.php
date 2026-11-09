<?php
/**
 * WorkScheduleSql.php
 * One answer to "what shift was this person on, that day", shared by every report that
 * needs it.
 *
 * Three sources, in descending authority:
 *
 *   1. Scheduling > Shift Management (`org_shift_schedule_patterns`) -- what we decided the
 *      person works. Outranks DeskTime because it is our own record, and it is the only
 *      source that can say a day is OFF.
 *   2. DeskTime's own work_starts/work_ends for that row, when they describe a real window.
 *   3. The shift the employee usually works on that weekday, derived from their history.
 *      Only some callers want this -- it is a reconstruction, not a record -- so it is a
 *      separate join rather than a third branch.
 *
 * DeskTime writes two sentinels rather than leaving the window empty: '00:00:00' for a
 * start it has nothing for, and '00:00:00' or '23:59:59' for the matching end. They are not
 * a shift from midnight to midnight, they mean "no schedule on file", which is why every
 * expression here tests for them instead of trusting the times. Sync_desktime_core.php
 * refuses to overwrite a stored schedule with them for the same reason.
 *
 * These expressions were lifted out of RunRateWindowSql.php, which still owns everything
 * about how a window is billed; that file now delegates here for how the window is found,
 * so the Run Rate, the Schedule Board, Attendance and Absenteeism cannot drift apart on
 * what shift someone was on.
 *
 * Every function returns a SQL expression string; nothing here touches the database.
 *
 * A Shift Management version is moved by an hour for employees with Daylight Saving on
 * (see DaylightSaving.php); DeskTime's own window never is.
 */

require_once __DIR__ . '/DaylightSaving.php';

// The pattern join below reads org_employee_daylight_saving, so the table has to exist
// before any report runs it. Every caller requires this file at the top level, right after
// db_wfm_config.php, so $pdo is already there; it runs once per request.
if (isset($GLOBALS['pdo']) && $GLOBALS['pdo'] instanceof PDO) {
    ensureEmployeeDaylightSavingTable($GLOBALS['pdo']);
}

/**
 * Resolves one row per (employee, date) with the shift Scheduling > Shift Management has
 * pinned for it, when a version covers that date. Exposes `smp.signature`.
 *
 * A schedule applied with a past Effective Start is authoritative over what DeskTime
 * recorded as the shift. Only the expected shift is affected -- tracked hours are never
 * rewritten.
 *
 * Ranked rather than joined directly because several versions can cover the same date
 * (that is how re-applying supersedes an old schedule); the newest effective_start wins,
 * matching resolveShiftSignature() in ShiftSchedulePatterns.php. Without the ranking every
 * overlapping version would duplicate the employee's row and double each SUM().
 *
 * Also exposes `smp.dst_seconds`: what Daylight Saving adds to the version's times on that
 * date, 0 for everyone without the option. The version is read as written for its
 * Effective Start, so a summer version shown on a winter day moves +1h (DaylightSaving.php).
 *
 * Binds the same :from / :to the surrounding query already uses.
 */
function shiftPatternJoinSql(): string
{
    return "LEFT JOIN (
                SELECT employee_id, log_date, signature, dst_seconds
                FROM (
                    SELECT dd.employee_id,
                           dd.log_date,
                           JSON_UNQUOTE(JSON_EXTRACT(p.pattern, CONCAT('$.\"', WEEKDAY(dd.log_date) + 1, '\"'))) AS signature,
                           CASE WHEN eds.employee_id IS NULL THEN 0
                                ELSE (" . usStandardTimeOffsetSql('dd.log_date') . " - " . usStandardTimeOffsetSql('p.effective_start') . ") * 3600
                           END AS dst_seconds,
                           ROW_NUMBER() OVER (
                               PARTITION BY dd.employee_id, dd.log_date
                               ORDER BY p.effective_start DESC, p.id DESC
                           ) AS rn
                    FROM (
                        SELECT DISTINCT employee_id, log_date
                        FROM desktime_employee_data
                        WHERE log_date BETWEEN :from AND :to
                    ) dd
                    INNER JOIN org_shift_schedule_patterns p
                            ON p.employee_id = dd.employee_id
                           AND dd.log_date BETWEEN p.effective_start AND p.effective_end
                    LEFT JOIN org_employee_daylight_saving eds ON eds.employee_id = dd.employee_id
                ) ranked
                WHERE rn = 1
            ) smp ON smp.employee_id = d.employee_id AND smp.log_date = d.log_date";
}

/**
 * Start of the shift the row is measured against: the Shift Management pattern first,
 * DeskTime's own window second, `$fallback` last.
 *
 * NULL on a day Shift Management marks OFF, whatever DeskTime reported -- an OFF day has no
 * shift, so it can hold neither scheduled hours nor a no-show. NULL is also the answer when
 * no source has a window at all, unless the caller passes a `$fallback` expression (the Run
 * Rate passes its reconstructed weekday shift; the attendance reports pass nothing, because
 * an absence has to be provable).
 *
 * Requires shiftPatternJoinSql() in the surrounding query for `smp`, and `d` for the
 * desktime_employee_data row.
 */
function shiftEffectiveStartSql(string $fallback = 'NULL'): string
{
    return "CASE
                WHEN smp.signature = 'OFF' THEN NULL
                WHEN smp.signature IS NOT NULL
                THEN " . shiftPatternTimeSql("SUBSTRING_INDEX(smp.signature, '|', 1)") . "
                WHEN d.work_starts != '00:00:00'
                     AND d.work_ends NOT IN ('00:00:00', '23:59:59')
                     AND d.work_ends > d.work_starts
                THEN d.work_starts
                ELSE $fallback
            END";
}

/**
 * A time out of a Shift Management signature, moved by the row's Daylight Saving seconds
 * and kept inside the day, as shiftTimeBySeconds() does in PHP.
 */
function shiftPatternTimeSql(string $timeExpr): string
{
    return "SEC_TO_TIME(LEAST(86399, GREATEST(0,
                TIME_TO_SEC(CAST($timeExpr AS TIME)) + COALESCE(smp.dst_seconds, 0)
            )))";
}

/** The matching end of that shift. Same three sources, same NULL rules. */
function shiftEffectiveEndSql(string $fallback = 'NULL'): string
{
    return "CASE
                WHEN smp.signature = 'OFF' THEN NULL
                WHEN smp.signature IS NOT NULL
                THEN " . shiftPatternTimeSql("SUBSTRING_INDEX(smp.signature, '|', -1)") . "
                WHEN d.work_starts != '00:00:00'
                     AND d.work_ends NOT IN ('00:00:00', '23:59:59')
                     AND d.work_ends > d.work_starts
                THEN d.work_ends
                ELSE $fallback
            END";
}

/**
 * The shift each employee usually works on each weekday, reconstructed from their own
 * DeskTime history. Selects (employee_id, weekday, work_starts, work_ends).
 *
 * Resolved per (employee, weekday), not per employee. A per-employee version hands the same
 * shift to every unshifted day, and DeskTime writes a row for every employee on every
 * calendar day, weekends included -- so a Saturday nobody was scheduled for would be billed
 * a full working day.
 *
 * A weekday only earns a reconstruction when the employee demonstrably works it: at least
 * half of the days recorded for that weekday carry a real shift or some tracked time.
 * Weekends fail that test for everyone except the few who genuinely work them, while a
 * weekday absence still passes it -- the evidence comes from the employee's other Tuesdays,
 * not from the Tuesday they were away -- which is what keeps missing hours visible.
 *
 * The shift itself is that weekday's most used one, with the employee's most used shift
 * overall as a second tier, for people DeskTime has never given a shift on a weekday they
 * nevertheless work. Both break ties on the latest date, so a schedule change takes over as
 * soon as it has matched the count of the one it replaces.
 *
 * `weekday` is WEEKDAY(), which numbers Monday 0 -- the numbering shiftPatternJoinSql()
 * shifts by one to index an ISO-keyed pattern.
 */
function weekdayModeShiftSql(): string
{
    return "SELECT worked.employee_id,
                   worked.weekday,
                   COALESCE(wd_mode.work_starts, any_mode.work_starts) AS work_starts,
                   COALESCE(wd_mode.work_ends, any_mode.work_ends) AS work_ends
            FROM (
                -- The weekdays this employee actually works.
                SELECT employee_id, WEEKDAY(log_date) AS weekday
                FROM desktime_employee_data
                GROUP BY employee_id, WEEKDAY(log_date)
                HAVING SUM(
                           (work_starts != '00:00:00'
                            AND work_ends NOT IN ('00:00:00', '23:59:59')
                            AND work_ends > work_starts)
                           OR at_work_time > 0
                           OR desktime_time > 0
                       ) * 2 >= COUNT(*)
            ) worked
            LEFT JOIN (
                -- Tier 1: that weekday's most used shift.
                SELECT employee_id, weekday, work_starts, work_ends
                FROM (
                    SELECT employee_id,
                           WEEKDAY(log_date) AS weekday,
                           work_starts,
                           work_ends,
                           ROW_NUMBER() OVER (
                               PARTITION BY employee_id, WEEKDAY(log_date)
                               ORDER BY COUNT(*) DESC, MAX(log_date) DESC
                           ) AS rn
                    FROM desktime_employee_data
                    WHERE work_starts != '00:00:00'
                      AND work_ends NOT IN ('00:00:00', '23:59:59')
                      AND work_ends > work_starts
                    GROUP BY employee_id, WEEKDAY(log_date), work_starts, work_ends
                ) ranked
                WHERE rn = 1
            ) wd_mode ON wd_mode.employee_id = worked.employee_id
                     AND wd_mode.weekday = worked.weekday
            LEFT JOIN (
                -- Tier 2: the employee's most used shift on any day.
                SELECT employee_id, work_starts, work_ends
                FROM (
                    SELECT employee_id,
                           work_starts,
                           work_ends,
                           ROW_NUMBER() OVER (
                               PARTITION BY employee_id
                               ORDER BY COUNT(*) DESC, MAX(log_date) DESC
                           ) AS rn
                    FROM desktime_employee_data
                    WHERE work_starts != '00:00:00'
                      AND work_ends NOT IN ('00:00:00', '23:59:59')
                      AND work_ends > work_starts
                    GROUP BY employee_id, work_starts, work_ends
                ) ranked
                WHERE rn = 1
            ) any_mode ON any_mode.employee_id = worked.employee_id";
}

/**
 * weekdayModeShiftSql() as a join, exposing `sched`, attached only to rows DeskTime
 * reported no start for. It only ever supplies a window; tracked time, holidays and
 * exceptions are untouched by it.
 */
function weekdayModeShiftJoinSql(): string
{
    return "LEFT JOIN (
                " . weekdayModeShiftSql() . "
            ) sched ON sched.employee_id = d.employee_id
                   AND sched.weekday = WEEKDAY(d.log_date)
                   AND d.work_starts = '00:00:00'";
}
