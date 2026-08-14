<?php
/**
 * RunRateWindowSql.php
 * SQL fragments shared by get_daily_run_rate.php (per day) and get_dashboard_stats.php
 * (MTD). Both resolve the same "working window" per employee-day and both have to clip it
 * the same way, so the expressions live here rather than being maintained twice.
 *
 * The working window is the shift the Run Rate already bills against:
 *   1. the employee's shift for that day, when it is valid, or
 *   2. their most frequently used historical shift (alias `sched`), or
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
 * Every function returns a SQL expression string; nothing here touches the database.
 */

/** The window's start, or NULL when the employee has no usable shift at all. */
function rrWindowStart(): string
{
    return "CASE
                WHEN d.work_starts != '00:00:00'
                     AND d.work_ends NOT IN ('00:00:00', '23:59:59')
                     AND d.work_ends > d.work_starts
                THEN d.work_starts
                ELSE sched.work_starts
            END";
}

/** The window's end, or NULL when the employee has no usable shift at all. */
function rrWindowEnd(): string
{
    return "CASE
                WHEN d.work_starts != '00:00:00'
                     AND d.work_ends NOT IN ('00:00:00', '23:59:59')
                     AND d.work_ends > d.work_starts
                THEN d.work_ends
                ELSE sched.work_ends
            END";
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

/** Tracked seconds for the row, honouring the team's at_work_time / desktime_time choice. */
function rrTrackedSeconds(): string
{
    return "CASE WHEN ot.run_rate_time_source = 'at_work_time'
                 THEN COALESCE(d.at_work_time, 0)
                 ELSE COALESCE(d.desktime_time, 0)
            END";
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
 * off, otherwise the team's lunch as long as some shift was found.
 */
function rrLunchHours(): string
{
    return "CASE
                WHEN COALESCE(ot.exclude_lunch_from_run_rate, 0) = 0 THEN 0
                WHEN " . rrWindowStart() . " IS NOT NULL THEN COALESCE(ot.lunch_time, 0) / 60.0
                ELSE 0
            END";
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
