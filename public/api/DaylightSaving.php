<?php
/**
 * DaylightSaving.php
 * Employees > Teams > Assign Members > Daylight Saving.
 *
 * The Dominican Republic does not change its clocks; the United States does. Someone
 * covering a US client keeps the same US hours all year, so in Santo Domingo time their
 * shift moves one hour later when the US goes back to standard time (first Sunday of
 * November) and one hour earlier when US daylight saving starts again (second Sunday of
 * March):
 *
 *   summer (US daylight saving)  08:00-17:00
 *   winter (US standard time)    09:00-18:00
 *
 * An employee with the checkbox on gets that hour applied to the schedules this system
 * sets: Shift Management versions, the forecast override and the shift the Schedule Board
 * and the Run Rate projection forecast from history. The shift DeskTime reports for a
 * recorded day is never moved: DeskTime already changes it for the teams that need it, and
 * moving it again would put them two hours off.
 *
 * Each of those schedules is read as written for the date it comes from (a version's
 * Effective Start, the source week of a forecast, the history days a pattern was learned
 * from), and shifted by the difference between that date and the date being shown:
 *
 *   hours added = offset(day shown) - offset(day the schedule comes from)
 *   offset      = 1 during US standard time, 0 during US daylight saving
 *
 * So a summer schedule shown on a winter day moves +1h, a winter schedule shown on a
 * summer day moves -1h, and a schedule shown in its own season is left as written.
 */

/** org_employee_daylight_saving: one row per employee with the option on. */
function ensureEmployeeDaylightSavingTable(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_employee_daylight_saving` (
          `employee_id` bigint(20) NOT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          PRIMARY KEY (`employee_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");
}

/** The US change dates for a year: daylight saving starts and ends, as Y-m-d. */
function usDaylightSavingDates(int $year): array
{
    return [
        'start' => (new DateTime("second sunday of march $year"))->format('Y-m-d'),
        'end' => (new DateTime("first sunday of november $year"))->format('Y-m-d'),
    ];
}

/** 1 on a date the US is on standard time (winter), 0 during daylight saving. */
function usStandardTimeOffset(string $date): int
{
    $dates = usDaylightSavingDates((int) substr($date, 0, 4));
    return ($date < $dates['start'] || $date >= $dates['end']) ? 1 : 0;
}

/** Seconds to add to a schedule written for $sourceDate when it is shown on $date. */
function daylightSavingShiftSeconds(string $date, string $sourceDate): int
{
    return (usStandardTimeOffset($date) - usStandardTimeOffset($sourceDate)) * 3600;
}

/**
 * 'HH:MM:SS' moved by $seconds, kept inside the same day (00:00:00 .. 23:59:59): a shift
 * that would cross midnight stops at it rather than wrapping to the morning.
 */
function shiftTimeBySeconds(string $time, int $seconds): string
{
    if ($seconds === 0) {
        return $time;
    }
    [$h, $m, $s] = array_map('intval', explode(':', $time) + [0, 0, 0]);
    $total = max(0, min(86399, $h * 3600 + $m * 60 + $s + $seconds));
    return sprintf('%02d:%02d:%02d', intdiv($total, 3600), intdiv($total % 3600, 60), $total % 60);
}

/**
 * A 'start|end' signature moved by $seconds. 'OFF' stays OFF. A moved shift whose start
 * would reach its end (only possible near midnight) keeps its original times.
 */
function shiftSignatureBySeconds(string $signature, int $seconds): string
{
    if ($seconds === 0 || $signature === 'OFF' || strpos($signature, '|') === false) {
        return $signature;
    }
    [$start, $end] = explode('|', $signature);
    $newStart = shiftTimeBySeconds($start, $seconds);
    $newEnd = shiftTimeBySeconds($end, $seconds);
    return $newEnd > $newStart ? "$newStart|$newEnd" : $signature;
}

/** Ids of the employees with the option on, as a set: employee_id => true. */
function fetchDaylightSavingEmployees(PDO $pdo, ?array $employeeIds = null): array
{
    ensureEmployeeDaylightSavingTable($pdo);
    if ($employeeIds !== null) {
        $employeeIds = array_values(array_unique(array_map('intval', $employeeIds)));
        if (empty($employeeIds)) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($employeeIds), '?'));
        $stmt = $pdo->prepare("SELECT employee_id FROM org_employee_daylight_saving WHERE employee_id IN ($placeholders)");
        $stmt->execute($employeeIds);
    } else {
        $stmt = $pdo->query("SELECT employee_id FROM org_employee_daylight_saving");
    }
    $set = [];
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $id) {
        $set[(int) $id] = true;
    }
    return $set;
}

/**
 * Sets the option for exactly the employees named: employee_id => bool. Anyone not named
 * is left as they are, so a person who moves teams keeps their setting.
 *
 * Caller owns the transaction.
 *
 * @return int how many of the named employees have it on
 */
function saveDaylightSavingEmployees(PDO $pdo, array $flags): int
{
    ensureEmployeeDaylightSavingTable($pdo);
    if (empty($flags)) {
        return 0;
    }
    $ids = array_values(array_unique(array_map('intval', array_keys($flags))));
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $pdo->prepare("DELETE FROM org_employee_daylight_saving WHERE employee_id IN ($placeholders)")->execute($ids);

    $insert = $pdo->prepare("INSERT INTO org_employee_daylight_saving (employee_id) VALUES (?)");
    $on = 0;
    foreach ($flags as $id => $enabled) {
        if ($enabled === true || $enabled === 1 || $enabled === '1' || $enabled === 'true') {
            $insert->execute([(int) $id]);
            $on++;
        }
    }
    return $on;
}

/**
 * SQL: 1 when the date expression falls in US standard time, 0 otherwise. Mirrors
 * usStandardTimeOffset(). March 1 + days to its first Sunday + 7 = the second Sunday;
 * WEEKDAY() numbers Monday 0, so (6 - WEEKDAY(day 1)) is the days to the first Sunday.
 */
function usStandardTimeOffsetSql(string $dateExpr): string
{
    $mar1 = "MAKEDATE(YEAR($dateExpr), 1) + INTERVAL 2 MONTH";
    $nov1 = "MAKEDATE(YEAR($dateExpr), 1) + INTERVAL 10 MONTH";
    $dstStart = "(($mar1) + INTERVAL (6 - WEEKDAY($mar1)) + 7 DAY)";
    $dstEnd = "(($nov1) + INTERVAL (6 - WEEKDAY($nov1)) DAY)";
    return "(CASE WHEN $dateExpr < $dstStart OR $dateExpr >= $dstEnd THEN 1 ELSE 0 END)";
}
