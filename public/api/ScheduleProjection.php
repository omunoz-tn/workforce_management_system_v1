<?php
/**
 * ScheduleProjection.php
 * The shift an employee is expected to work on a day DeskTime has no record for yet.
 *
 * Lifted out of get_schedule_board.php so the Schedule Board and the projected Run Rate
 * (get_run_rate_projection.php) read the same future shift. Two copies of this chain
 * would drift, and the Run Rate would end up billing a day the board shows as OFF — the
 * same disagreement the weekday fallback in WorkScheduleSql.php was written to end.
 *
 * Precedence, first match wins:
 *   1. a Non-Working holiday for the employee's team        -> OFF
 *   2. a Shift Management version covering the date          -> its shift (or OFF)
 *   3. the Configuration > Scheduling > Forecast override    -> its weekday (or OFF)
 *   4. the weekday pattern of the last 6 weeks (tier 1)      -> that shift (or OFF)
 *   5. the employee's all-time most used shift (tier 2)      -> that shift
 *   6. nothing                                               -> null (no projection)
 *
 * Everything is loaded once by loadScheduleProjection() and resolved per day by
 * projectShift(), so callers pay for the history scan once however many days they ask for.
 *
 * `$asOf` is the first day being projected; the history is read from the 42 days before
 * it. It defaults to today, which is what the board uses. The Run Rate backtest passes a
 * past date so a month can be projected the way it would have been on its first day,
 * without seeing any of the data it is being compared against.
 *
 * For employees with Daylight Saving on, every tier's shift is moved by the hour the US
 * clocks changed between the date that shift comes from and the day being projected
 * (DaylightSaving.php). Each tier records that source date next to its shift.
 */

require_once __DIR__ . '/ShiftSchedulePatterns.php';
require_once __DIR__ . '/DaylightSaving.php';

/**
 * A DeskTime shift the rest of the platform treats as real: both ends set, end after start.
 * Some synced rows carry NULL for both; those are simply not a shift, as they always were
 * on the board.
 */
function projectionIsValidShift(?string $start, ?string $end): bool
{
    if ($start === null || $end === null) {
        return false;
    }
    return $start !== '00:00:00'
        && !in_array($end, ['00:00:00', '23:59:59'], true)
        && $end > $start;
}

function projectionIsoWeekday(string $dateStr): int
{
    return (int) (new DateTime($dateStr))->format('N'); // 1 = Monday ... 7 = Sunday
}

/**
 * Loads everything projectShift() needs for these employees over [$from, $to].
 *
 * @param int[] $employeeIds
 */
function loadScheduleProjection(PDO $pdo, array $employeeIds, string $from, string $to, ?string $asOf = null): array
{
    $asOf = $asOf ?: date('Y-m-d');
    $employeeIds = array_values(array_unique(array_map('intval', $employeeIds)));

    $ctx = [
        'asOf' => $asOf,
        'weekdayPattern' => [],
        // employee => ISO weekday => the latest date that weekday's shift was seen.
        'weekdayPatternSource' => [],
        'tier2' => [],
        // employee_id => true, for those with Daylight Saving on.
        'daylightSaving' => [],
        'overrides' => [],
        'overrideSignature' => [],
        'shiftPatterns' => [],
        'holidays' => [],
        'holidayOverrides' => [],
    ];

    // Holidays in range, resolved per team. org_holidays.holiday_type is the org-wide
    // default and org_team_holiday_types holds only the teams that disagree, so the same
    // date can close one team and not another. Loaded even with no employees, because the
    // board labels holiday cells from these too.
    $stmt = $pdo->prepare("SELECT id, name, country_code, holiday_date, holiday_type FROM org_holidays WHERE holiday_date BETWEEN :from AND :to");
    $stmt->execute(['from' => $from, 'to' => $to]);
    $ctx['holidays'] = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmt = $pdo->prepare("SELECT tht.team_id, tht.holiday_id, tht.holiday_type, tht.exclude_from, tht.exclude_to
                           FROM org_team_holiday_types tht
                           INNER JOIN org_holidays oh ON oh.id = tht.holiday_id
                           WHERE oh.holiday_date BETWEEN :from AND :to");
    $stmt->execute(['from' => $from, 'to' => $to]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $ctx['holidayOverrides'][(int) $row['team_id']][(int) $row['holiday_id']] = $row;
    }

    // Shift Management's versioned weekly patterns.
    $ctx['shiftPatterns'] = fetchShiftPatternsForRange($pdo, $from, $to);

    if (empty($employeeIds)) {
        return $ctx;
    }

    $idList = implode(',', $employeeIds);

    $ctx['daylightSaving'] = fetchDaylightSavingEmployees($pdo, $employeeIds);

    // Tier 2: each employee's all-time most used valid shift, from history before $asOf.
    // Ties go to the shift used most recently, the same rule weekdayModeShiftSql() uses.
    $stmt = $pdo->prepare("
        SELECT employee_id, work_starts, work_ends, last_date
        FROM (
            SELECT employee_id,
                   work_starts,
                   work_ends,
                   MAX(log_date) AS last_date,
                   ROW_NUMBER() OVER (
                       PARTITION BY employee_id
                       ORDER BY COUNT(*) DESC, MAX(log_date) DESC
                   ) AS rn
            FROM desktime_employee_data
            WHERE employee_id IN ($idList)
              AND log_date < :asOf
              AND work_starts != '00:00:00'
              AND work_ends NOT IN ('00:00:00', '23:59:59')
              AND work_ends > work_starts
            GROUP BY employee_id, work_starts, work_ends
        ) ranked
        WHERE rn = 1
    ");
    $stmt->execute(['asOf' => $asOf]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $ctx['tier2'][(int) $row['employee_id']] = [
            'start' => $row['work_starts'],
            'end' => $row['work_ends'],
            'source' => $row['last_date'],
        ];
    }

    // Tier 1: the typical shift (or OFF) for EACH weekday over the 42 days before $asOf —
    // exactly 6 occurrences of every weekday.
    $lookbackEnd = date('Y-m-d', strtotime($asOf . ' -1 day'));
    $lookbackStart = date('Y-m-d', strtotime($asOf . ' -42 days'));

    // Raw history rows, no team joins: joining org_team_assignments here could fan out (an
    // employee can belong to more than one team) and double-count a day in the tally.
    $stmt = $pdo->prepare("
        SELECT employee_id, log_date, work_starts, work_ends
        FROM desktime_employee_data
        WHERE log_date BETWEEN :lookbackStart AND :lookbackEnd
          AND employee_id IN ($idList)
        ORDER BY log_date ASC, work_starts ASC
    ");
    $stmt->execute(['lookbackStart' => $lookbackStart, 'lookbackEnd' => $lookbackEnd]);
    $historyRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmt = $pdo->prepare("
        SELECT employee_id, MIN(log_date) AS first_seen
        FROM desktime_employee_data
        WHERE employee_id IN ($idList)
        GROUP BY employee_id
    ");
    $stmt->execute();
    $firstSeen = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $firstSeen[(int) $row['employee_id']] = $row['first_seen'];
    }

    // Collapse to one signature per employee+date: a valid shift, or 'OFF'. Rows arrive
    // log_date ASC, work_starts ASC, so when two DeskTime accounts produced two rows for the
    // same day, the first valid shift wins deterministically over a later OFF/invalid row.
    $daySignature = [];
    foreach ($historyRows as $row) {
        $id = (int) $row['employee_id'];
        $date = $row['log_date'];
        if (projectionIsValidShift($row['work_starts'], $row['work_ends'])) {
            $daySignature[$id][$date] = $row['work_starts'] . '|' . $row['work_ends'];
        } elseif (!isset($daySignature[$id][$date])) {
            $daySignature[$id][$date] = 'OFF';
        }
    }

    $weekdayDates = [];
    $period = new DatePeriod(new DateTime($lookbackStart), new DateInterval('P1D'), (new DateTime($lookbackEnd))->modify('+1 day'));
    foreach ($period as $day) {
        $dateStr = $day->format('Y-m-d');
        $weekdayDates[projectionIsoWeekday($dateStr)][] = $dateStr;
    }

    $MIN_PATTERN_SAMPLES = 2;

    foreach ($employeeIds as $id) {
        $employeeFirstSeen = $firstSeen[$id] ?? null;
        for ($weekday = 1; $weekday <= 7; $weekday++) {
            $tally = []; // signature => ['count' => n, 'lastDate' => 'Y-m-d']
            foreach ($weekdayDates[$weekday] ?? [] as $date) {
                if ($employeeFirstSeen !== null && $date < $employeeFirstSeen) {
                    continue; // pre-hire calendar days are not evidence of OFF
                }
                $signature = $daySignature[$id][$date] ?? 'OFF';
                if (!isset($tally[$signature])) {
                    $tally[$signature] = ['count' => 0, 'lastDate' => null];
                }
                $tally[$signature]['count']++;
                $tally[$signature]['lastDate'] = $date; // dates visited oldest -> newest
            }

            if (empty($tally)) {
                continue;
            }

            uasort($tally, function ($a, $b) {
                if ($a['count'] !== $b['count']) {
                    return $b['count'] <=> $a['count'];
                }
                return $b['lastDate'] <=> $a['lastDate'];
            });
            $bestSignature = array_key_first($tally);

            if ($tally[$bestSignature]['count'] < $MIN_PATTERN_SAMPLES) {
                continue; // not enough recent evidence, tier 2 handles it
            }

            $ctx['weekdayPattern'][$id][$weekday] = $bestSignature; // 'OFF' or 'start|end'
            $ctx['weekdayPatternSource'][$id][$weekday] = $tally[$bestSignature]['lastDate'];
        }
    }

    // Manual forecast overrides (Configuration > Scheduling > Forecast): a pinned source
    // week applied per weekday up to a chosen end week.
    $stmt = $pdo->prepare("
        SELECT employee_id, source_week_start, target_end_week_start, pattern
        FROM org_schedule_forecast_overrides
        WHERE employee_id IN ($idList)
    ");
    $stmt->execute();
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $ctx['overrides'][(int) $row['employee_id']] = $row;
    }

    foreach ($ctx['overrides'] as $empId => $override) {
        // Seed all 7 weekdays as OFF so a missing weekday doesn't fall through to tier 1/2.
        for ($weekday = 1; $weekday <= 7; $weekday++) {
            $ctx['overrideSignature'][$empId][$weekday] = 'OFF';
        }

        $pattern = $override['pattern'] ? json_decode($override['pattern'], true) : null;
        if ($pattern) {
            // Captured (and possibly hand-edited) at save time in Forecast Settings.
            foreach ($pattern as $weekday => $signature) {
                $ctx['overrideSignature'][$empId][(int) $weekday] = $signature;
            }
            continue;
        }

        // Overrides saved before the pattern column existed: re-derive the signature from
        // that source week's synced data.
        $sourceStart = new DateTime($override['source_week_start']);
        $sourceEnd = (clone $sourceStart)->modify('+6 days');

        $sourceStmt = $pdo->prepare("
            SELECT log_date, work_starts, work_ends
            FROM desktime_employee_data
            WHERE employee_id = :employee_id AND log_date BETWEEN :s AND :e
            ORDER BY work_starts ASC
        ");
        $sourceStmt->execute([
            'employee_id' => $empId,
            's' => $sourceStart->format('Y-m-d'),
            'e' => $sourceEnd->format('Y-m-d')
        ]);
        $seenWeekdays = [];
        foreach ($sourceStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $weekday = projectionIsoWeekday($row['log_date']);
            if (isset($seenWeekdays[$weekday])) {
                continue; // first row wins if a day has 2 rows (two DeskTime accounts)
            }
            $seenWeekdays[$weekday] = true;
            $ctx['overrideSignature'][$empId][$weekday] = projectionIsValidShift($row['work_starts'], $row['work_ends'])
                ? ($row['work_starts'] . '|' . $row['work_ends'])
                : 'OFF';
        }
    }

    return $ctx;
}

/** True when any holiday on that date is non_working for this team. */
function projectionIsNonWorking(array $ctx, ?int $teamId, string $dateStr): bool
{
    foreach ($ctx['holidays'] as $holiday) {
        if ($holiday['holiday_date'] !== $dateStr) {
            continue;
        }
        $effective = $ctx['holidayOverrides'][$teamId][(int) $holiday['id']]['holiday_type'] ?? $holiday['holiday_type'];
        if ($effective === 'non_working') {
            return true;
        }
    }
    return false;
}

/**
 * Every holiday governing this team on a date, each with the type the team gave it —
 * plural, because org_holidays is unique per (country_code, holiday_date).
 */
function projectionHolidaysFor(array $ctx, ?int $teamId, string $dateStr): array
{
    $found = [];
    foreach ($ctx['holidays'] as $holiday) {
        if ($holiday['holiday_date'] !== $dateStr) {
            continue;
        }
        $override = $ctx['holidayOverrides'][$teamId][(int) $holiday['id']] ?? null;
        $type = $override['holiday_type'] ?? $holiday['holiday_type'];
        $info = [
            'name' => $holiday['name'],
            'type' => $type,
            'country' => $holiday['country_code'],
            'custom' => $override !== null,
        ];
        if ($type === 'campaign_defined' && !empty($override['exclude_from'])) {
            $info['from'] = $override['exclude_from'];
            $info['to'] = $override['exclude_to'];
        }
        $found[] = $info;
    }
    return $found;
}

/**
 * The Custom (campaign_defined) window a team discounts on a date, or null. Two holidays
 * on the same date merge into the single enclosing window, as rrCampaignExclusionJoin()
 * does for recorded days.
 *
 * @return array{from:string,to:string}|null
 */
function projectionCustomWindow(array $ctx, ?int $teamId, string $dateStr): ?array
{
    if ($teamId === null) {
        return null;
    }
    $from = null;
    $to = null;
    foreach ($ctx['holidays'] as $holiday) {
        if ($holiday['holiday_date'] !== $dateStr) {
            continue;
        }
        $override = $ctx['holidayOverrides'][$teamId][(int) $holiday['id']] ?? null;
        if (!$override || $override['holiday_type'] !== 'campaign_defined'
            || $override['exclude_from'] === null || $override['exclude_to'] === null) {
            continue;
        }
        $from = $from === null ? $override['exclude_from'] : min($from, $override['exclude_from']);
        $to = $to === null ? $override['exclude_to'] : max($to, $override['exclude_to']);
    }
    return $from === null ? null : ['from' => $from, 'to' => $to];
}

/**
 * The projected shift for one employee on one date.
 *
 * Returns ['start', 'end', 'manualOverride'] — start/end '00:00:00' for an OFF day — or
 * null when no tier has anything to say (the board leaves that cell empty, and the Run
 * Rate bills it as 0 scheduled hours).
 */
function projectShift(array $ctx, int $employeeId, ?int $teamId, string $dateStr): ?array
{
    $off = function (bool $manual) {
        return ['start' => '00:00:00', 'end' => '00:00:00', 'manualOverride' => $manual];
    };
    // `$source` is the date the shift was written for or seen on; with Daylight Saving on,
    // the shift moves by the hour the US clocks changed between it and $dateStr.
    $dst = isset($ctx['daylightSaving'][$employeeId]);
    $fromSignature = function (string $signature, bool $manual, ?string $source = null) use ($off, $dst, $dateStr) {
        if ($signature === 'OFF') {
            return $off($manual);
        }
        if ($dst && $source !== null) {
            $signature = shiftSignatureBySeconds($signature, daylightSavingShiftSeconds($dateStr, $source));
        }
        [$start, $end] = explode('|', $signature);
        return ['start' => $start, 'end' => $end, 'manualOverride' => $manual];
    };

    // A non-working holiday closes the day for the team, outranking even a manual override.
    // It is reported as a plain (non-manual) OFF, as the board always has.
    if (projectionIsNonWorking($ctx, $teamId, $dateStr)) {
        return $off(false);
    }

    $weekday = projectionIsoWeekday($dateStr);

    // Tier 0a: a Shift Management version covering this date.
    $version = resolveShiftVersion($ctx['shiftPatterns'][$employeeId] ?? [], $dateStr);
    if ($version !== null) {
        return $fromSignature($version['signature'], true, $version['effective_start']);
    }

    // Tier 0b: the forecast override, while the date's week is within its chosen range.
    $override = $ctx['overrides'][$employeeId] ?? null;
    if ($override && shiftWeekMondayOf($dateStr) <= $override['target_end_week_start']) {
        return $fromSignature($ctx['overrideSignature'][$employeeId][$weekday] ?? 'OFF', true, $override['source_week_start']);
    }

    // Tier 1: the weekday pattern.
    $signature = $ctx['weekdayPattern'][$employeeId][$weekday] ?? null;
    if ($signature !== null) {
        return $fromSignature($signature, false, $ctx['weekdayPatternSource'][$employeeId][$weekday] ?? null);
    }

    // Tier 2: the all-time most used shift.
    $tier2 = $ctx['tier2'][$employeeId] ?? null;
    if ($tier2) {
        return $fromSignature($tier2['start'] . '|' . $tier2['end'], false, $tier2['source'] ?? null);
    }

    return null;
}
