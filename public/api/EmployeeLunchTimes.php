<?php
/**
 * EmployeeLunchTimes.php
 * Per-employee, per-weekday lunch overrides (Employees > Teams > Assign Members >
 * Lunch Time > Employee Lunch Time).
 *
 * org_teams.lunch_time is the team-wide default and stays where it was; this table only
 * holds the weekdays one employee disagrees with it, so somebody left on the default keeps
 * following later changes to it:
 *
 *   effective lunch = COALESCE(org_employee_lunch_times.lunch_time, org_teams.lunch_time, 0)
 *
 * That resolution is what every report has to apply, so the two SQL fragments below are
 * shared rather than re-typed: elLunchJoin() attaches the override for the row's weekday,
 * elLunchMinutes() reads the effective value. Both assume the caller's row already carries
 * a date and the org_teams alias.
 *
 * Unlike the per-team holiday types, storage here is NOT sparse: a weekday set to the same
 * number as the team default is still stored. The cell is a plain number the user typed
 * next to the team's own value, and clearing it is the explicit way to go back to
 * inheriting — dropping it on save would blank the cell the user just filled in.
 *
 * Pure functions plus SQL strings — no output, no dispatch — so it is safe to require
 * anywhere.
 */

/** Widest lunch a weekday may be given, in minutes. Guards typos, not policy. */
const MAX_EMPLOYEE_LUNCH_MINUTES = 600;

/**
 * Attaches the override row for each result row's own weekday.
 *
 * The table is unique on (employee_id, weekday) and the join pins the weekday, so this can
 * never duplicate an employee's rows — unlike the team/holiday joins, it needs no grouping.
 *
 * MySQL's WEEKDAY() numbers Monday 0; the stored weekday is ISO (Monday 1), the same
 * numbering org_shift_schedule_patterns.pattern is keyed by, hence the + 1.
 */
function elLunchJoin(string $employeeExpr = 'd.employee_id', string $dateExpr = 'd.log_date', string $alias = 'elt'): string
{
    return "LEFT JOIN org_employee_lunch_times $alias
                   ON $alias.employee_id = $employeeExpr
                  AND $alias.weekday = WEEKDAY($dateExpr) + 1";
}

/** Effective lunch minutes for the row: the employee's weekday override, else the team's. */
function elLunchMinutes(string $alias = 'elt', string $teamAlias = 'ot'): string
{
    return "COALESCE($alias.lunch_time, $teamAlias.lunch_time, 0)";
}

/**
 * Same value inside a GROUP BY that collapses an employee's day into one row.
 *
 * MIN() skips NULLs, so a plain MIN(COALESCE(...)) would let a row where the override is
 * missing win over one where it is present. Both aliases are constant within the group
 * anyway; wrapping each side separately keeps the override's precedence intact.
 */
function elLunchMinutesGrouped(string $alias = 'elt', string $teamAlias = 'ot'): string
{
    return "COALESCE(MIN($alias.lunch_time), MIN($teamAlias.lunch_time), 0)";
}

/**
 * Overrides for the given employees (or everyone, when null), as
 * employee_id => [weekday => minutes], both ends as ints.
 */
function fetchEmployeeLunchTimes(PDO $pdo, ?array $employeeIds = null): array
{
    if ($employeeIds !== null) {
        $employeeIds = array_values(array_unique(array_map('intval', $employeeIds)));
        if (empty($employeeIds)) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($employeeIds), '?'));
        $stmt = $pdo->prepare(
            "SELECT employee_id, weekday, lunch_time FROM org_employee_lunch_times
             WHERE employee_id IN ($placeholders) ORDER BY employee_id, weekday"
        );
        $stmt->execute($employeeIds);
    } else {
        $stmt = $pdo->query(
            "SELECT employee_id, weekday, lunch_time FROM org_employee_lunch_times
             ORDER BY employee_id, weekday"
        );
    }

    $map = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $map[(int) $row['employee_id']][(int) $row['weekday']] = (int) $row['lunch_time'];
    }
    return $map;
}

/**
 * Replaces the override set of exactly the employees named as keys.
 *
 * An employee absent from the map is left alone — the modal sends an entry for every
 * member it is showing, including an empty one for those back on the team default, so
 * clearing a cell removes the row. Someone dropped from the team in the same save is
 * simply not mentioned, and keeps the overrides they had: they belong to the employee,
 * not to the team, and would follow them to their next one.
 *
 * Caller owns the transaction.
 *
 * @param array $lunchTimes employee_id => [weekday => minutes | '' | null]
 * @return int how many override rows were stored
 */
function saveEmployeeLunchTimes(PDO $pdo, array $lunchTimes): int
{
    if (empty($lunchTimes)) {
        return 0;
    }

    $employeeIds = array_values(array_unique(array_map('intval', array_keys($lunchTimes))));
    $placeholders = implode(',', array_fill(0, count($employeeIds), '?'));
    $pdo->prepare("DELETE FROM org_employee_lunch_times WHERE employee_id IN ($placeholders)")
        ->execute($employeeIds);

    $insert = $pdo->prepare(
        "INSERT INTO org_employee_lunch_times (employee_id, weekday, lunch_time) VALUES (?, ?, ?)"
    );

    $stored = 0;
    foreach ($lunchTimes as $employeeId => $days) {
        if (!is_array($days)) {
            continue;
        }
        foreach ($days as $weekday => $minutes) {
            $minutes = normalizeLunchMinutes($minutes);
            if ($minutes === null) {
                continue; // blank cell: inherit the team default
            }
            $insert->execute([(int) $employeeId, (int) $weekday, $minutes]);
            $stored++;
        }
    }

    return $stored;
}

/** '', null and non-numeric text all mean "inherit"; anything else becomes whole minutes. */
function normalizeLunchMinutes($value): ?int
{
    if ($value === null || $value === '' || is_array($value)) {
        return null;
    }
    if (!is_numeric($value)) {
        return null;
    }
    return (int) $value;
}

/**
 * Rejects an out-of-range weekday or lunch length before it reaches the INSERT, so a bad
 * payload fails as a 400 instead of storing a deduction nobody can explain later.
 */
function validateEmployeeLunchTimes(array $lunchTimes): void
{
    foreach ($lunchTimes as $employeeId => $days) {
        if (!is_array($days)) {
            throw new InvalidArgumentException(
                "Lunch times for employee $employeeId must be a map of weekday => minutes."
            );
        }
        foreach ($days as $weekday => $minutes) {
            if (!is_numeric($weekday) || (int) $weekday < 1 || (int) $weekday > 7) {
                throw new InvalidArgumentException("Invalid weekday: $weekday (expected 1-7).");
            }

            // A value the normalizer would silently drop is only acceptable when it is
            // genuinely empty. Text that is not a number means the client sent something
            // unexpected, and dropping it would look like a saved "inherit".
            if ($minutes !== null && $minutes !== '' && !is_numeric($minutes)) {
                throw new InvalidArgumentException("Lunch time must be a number, got: $minutes");
            }

            $normalized = normalizeLunchMinutes($minutes);
            if ($normalized === null) {
                continue;
            }
            if ($normalized < 0 || $normalized > MAX_EMPLOYEE_LUNCH_MINUTES) {
                throw new InvalidArgumentException(
                    "Lunch time must be between 0 and " . MAX_EMPLOYEE_LUNCH_MINUTES . " minutes, got: $normalized"
                );
            }
        }
    }
}
