<?php
/**
 * ShiftSchedulePatterns.php
 * Shared helpers for Scheduling > Shift Management, used by manage_shift_schedule.php
 * (read/preview/apply) and get_schedule_board.php (rendering the board).
 *
 * A pattern maps ISO weekday (1=Mon .. 7=Sun) to either "OFF" or "HH:MM:SS|HH:MM:SS".
 * Versions are rows in org_shift_schedule_patterns with an effective_start/effective_end
 * range; for a given date the version with the latest effective_start that still covers it
 * wins, so re-applying a schedule supersedes the old one without erasing it.
 *
 * Pure functions only — no output, no dispatch.
 */

/** Monday of the week a date falls in, as Y-m-d. */
function shiftWeekMondayOf(string $dateStr): string
{
    $d = new DateTime($dateStr);
    $weekday = (int) $d->format('N');
    $d->modify('-' . ($weekday - 1) . ' days');
    return $d->format('Y-m-d');
}

/**
 * Rejects anything that is not a full 7-day pattern of "OFF" or "HH:MM:SS|HH:MM:SS", and
 * any shift that does not end after it starts.
 *
 * @return array<int,string> weekday => signature
 */
function validateShiftPattern($pattern): array
{
    if (!is_array($pattern)) {
        throw new InvalidArgumentException('pattern must be an object keyed by weekday');
    }

    $clean = [];
    for ($weekday = 1; $weekday <= 7; $weekday++) {
        $value = $pattern[$weekday] ?? $pattern[(string) $weekday] ?? null;
        if ($value === null || $value === 'OFF') {
            $clean[$weekday] = 'OFF';
            continue;
        }
        if (!is_string($value) || substr_count($value, '|') !== 1) {
            throw new InvalidArgumentException("Invalid shift for weekday $weekday.");
        }
        [$start, $end] = explode('|', $value);
        if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/', $start)
            || !preg_match('/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/', $end)) {
            throw new InvalidArgumentException("Invalid time on weekday $weekday. Use HH:MM:SS.");
        }
        if (strtotime("1970-01-01 $end") <= strtotime("1970-01-01 $start")) {
            throw new InvalidArgumentException(
                "Weekday $weekday ends at $end, which is not after its $start start."
            );
        }
        $clean[$weekday] = "$start|$end";
    }
    return $clean;
}

/**
 * Every stored version for an employee, newest effective_start first.
 *
 * @return array<int,array> rows with `pattern` already decoded
 */
function fetchShiftPatternVersions(PDO $pdo, int $employeeId): array
{
    $stmt = $pdo->prepare(
        "SELECT id, employee_id, employee_name, effective_start, effective_end, pattern, created_at, updated_at
         FROM org_shift_schedule_patterns
         WHERE employee_id = ?
         ORDER BY effective_start DESC, id DESC"
    );
    $stmt->execute([$employeeId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$row) {
        $row['pattern'] = json_decode($row['pattern'], true) ?: [];
    }
    return $rows;
}

/**
 * Loads the versions overlapping a date range, indexed by employee, for the board.
 * Ordered so that the first match found while scanning is the winning one.
 *
 * @return array<int,array<int,array>> employee_id => list of versions
 */
function fetchShiftPatternsForRange(PDO $pdo, string $from, string $to): array
{
    $stmt = $pdo->prepare(
        "SELECT employee_id, effective_start, effective_end, pattern
         FROM org_shift_schedule_patterns
         WHERE effective_start <= :to AND effective_end >= :from
         ORDER BY effective_start DESC, id DESC"
    );
    $stmt->execute(['from' => $from, 'to' => $to]);

    $byEmployee = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $row['pattern'] = json_decode($row['pattern'], true) ?: [];
        $byEmployee[(int) $row['employee_id']][] = $row;
    }
    return $byEmployee;
}

/**
 * The signature this employee's schedule calls for on a date, or null when no version
 * covers it. Versions arrive newest-first, so the first cover wins.
 *
 * @param array<int,array> $versions
 */
function resolveShiftSignature(array $versions, string $dateStr): ?string
{
    foreach ($versions as $version) {
        if ($dateStr < $version['effective_start'] || $dateStr > $version['effective_end']) {
            continue;
        }
        $weekday = (int) (new DateTime($dateStr))->format('N');
        $signature = $version['pattern'][$weekday] ?? $version['pattern'][(string) $weekday] ?? null;
        return $signature ?: 'OFF';
    }
    return null;
}

/**
 * The manual forecast override from Configuration > Scheduling > Forecast, or null.
 * There is at most one per employee (that table is UNIQUE on employee_id).
 */
function fetchForecastOverride(PDO $pdo, int $employeeId): ?array
{
    $stmt = $pdo->prepare(
        "SELECT id, employee_id, source_week_start, target_end_week_start
         FROM org_schedule_forecast_overrides
         WHERE employee_id = ?"
    );
    $stmt->execute([$employeeId]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
}

/**
 * Last date a forecast override still governs: it runs from "tomorrow" through the Sunday
 * of its target end week (see the tier check in get_schedule_board.php).
 */
function forecastOverrideLastDate(array $override): string
{
    return (new DateTime($override['target_end_week_start']))->modify('+6 days')->format('Y-m-d');
}

/**
 * True when a new Shift Management period leaves the override with no date of its own.
 *
 * Only then is deleting it safe. The override has no start date — it applies from tomorrow
 * onward — so a period starting later would leave the days before it unforecast, and a
 * period ending sooner would leave the tail unforecast. In those cases the override stays
 * and read-time precedence in get_schedule_board.php handles the overlap.
 */
function forecastOverrideFullySuperseded(
    array $override,
    string $effectiveStart,
    string $effectiveEnd,
    string $today
): bool {
    $tomorrow = (new DateTime($today))->modify('+1 day')->format('Y-m-d');
    return $effectiveStart <= $tomorrow && $effectiveEnd >= forecastOverrideLastDate($override);
}

/** True when the forecast override governs that date. */
function forecastOverrideCovers(?array $override, string $dateStr, string $today): bool
{
    if (!$override) {
        return false;
    }
    return $dateStr > $today && $dateStr <= forecastOverrideLastDate($override);
}

/**
 * Counts what applying a pattern over a range would do, for the preview shown before
 * saving. `$syncedDates` are the dates DeskTime already has data for; a past date is only
 * counted when it has such a record, since there is otherwise nothing to rewrite.
 *
 * `replaced` covers days that already had an explicitly set schedule: an earlier Shift
 * Management version, or the manual forecast override. Algorithmic predictions are not
 * counted — they are recomputed on every read, so there is nothing there to replace.
 *
 * @return array{days:int,shifts:int,off_days:int,replaced:int,replaced_schedule:int,replaced_forecast:int,skipped_past:int,first_applied:?string}
 */
function summarizeShiftPatternApply(
    array $pattern,
    string $effectiveStart,
    string $effectiveEnd,
    string $today,
    array $syncedDates,
    array $existingVersions,
    ?array $forecastOverride = null
): array {
    $summary = [
        'days' => 0,
        'shifts' => 0,
        'off_days' => 0,
        'replaced' => 0,
        'replaced_schedule' => 0,
        'replaced_forecast' => 0,
        'skipped_past' => 0,
        'first_applied' => null,
    ];

    $period = new DatePeriod(
        new DateTime($effectiveStart),
        new DateInterval('P1D'),
        (new DateTime($effectiveEnd))->modify('+1 day')
    );

    foreach ($period as $day) {
        $dateStr = $day->format('Y-m-d');
        $summary['days']++;

        // A past day only changes if there is a record to change: the schedule replaces the
        // shift on days DeskTime already synced, but cannot invent a day that was never
        // recorded. Future days always apply — the board projects them.
        if ($dateStr <= $today && !isset($syncedDates[$dateStr])) {
            $summary['skipped_past']++;
            continue;
        }

        if ($summary['first_applied'] === null) {
            $summary['first_applied'] = $dateStr;
        }

        $weekday = (int) $day->format('N');
        $signature = $pattern[$weekday] ?? 'OFF';
        if ($signature === 'OFF') {
            $summary['off_days']++;
        } else {
            $summary['shifts']++;
        }

        // An earlier Shift Management version takes priority in the count: if both cover the
        // date, the version is what was actually in force, so it is the thing being replaced.
        if (resolveShiftSignature($existingVersions, $dateStr) !== null) {
            $summary['replaced_schedule']++;
            $summary['replaced']++;
        } elseif (forecastOverrideCovers($forecastOverride, $dateStr, $today)) {
            $summary['replaced_forecast']++;
            $summary['replaced']++;
        }
    }

    return $summary;
}
