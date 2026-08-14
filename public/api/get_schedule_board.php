<?php
/**
 * get_schedule_board.php
 * Read-only endpoint to fetch employee schedules for a week.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    session_start();
    $isRestricted = isset($_SESSION['allowed_teams']) && !empty($_SESSION['allowed_teams']) && $_SESSION['role_name'] !== 'Admin';
    $allowedTeams = $isRestricted ? $_SESSION['allowed_teams'] : [];
    $teamFilter = $isRestricted ? " AND ota.team_id IN (" . implode(',', array_map('intval', $allowedTeams)) . ") " : "";

    $from = $_GET['from'] ?? null;
    $to = $_GET['to'] ?? null;

    if (!$from || !$to) {
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
            ORDER BY d.name ASC, d.log_date ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute(['from' => $from, 'to' => $to]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Roster of currently active employees, each paired with their most frequently
    // used historical valid shift. Used to project a schedule onto future days that
    // have no synced DeskTime record yet (same "mode of past shifts" logic used as
    // the scheduled-hours fallback in get_daily_run_rate.php).
    $rosterSql = "SELECT
                r.employee_id,
                r.name,
                COALESCE(ot.name, r.group_name) as team_name,
                ota.team_id,
                ot.lunch_time as team_lunch,
                sched.work_starts as predicted_start,
                sched.work_ends as predicted_end
            FROM (
                SELECT d.employee_id, d.name, d.group_name
                FROM desktime_employee_data d
                INNER JOIN (
                    SELECT employee_id, MAX(log_date) as max_log_date
                    FROM desktime_employee_data
                    GROUP BY employee_id
                    -- Each employee's own latest sync date, as long as it's within a few
                    -- days of the newest data in the whole table. Using a single global
                    -- MAX(log_date) here (like the old query did) wrongly drops anyone
                    -- whose sync simply landed a day later than everyone else's; but with
                    -- no floor at all, employees who stopped syncing months ago would flood
                    -- the roster too (confirmed: a steep drop-off after ~1 day behind).
                    HAVING MAX(log_date) >= (SELECT DATE_SUB(MAX(log_date), INTERVAL 3 DAY) FROM desktime_employee_data)
                ) latest ON latest.employee_id = d.employee_id AND latest.max_log_date = d.log_date
            ) r
            LEFT JOIN org_team_assignments ota ON r.employee_id = ota.employee_id
            LEFT JOIN org_teams ot ON ota.team_id = ot.id
            LEFT JOIN (
                SELECT employee_id, work_starts, work_ends
                FROM (
                    SELECT
                        employee_id,
                        work_starts,
                        work_ends,
                        ROW_NUMBER() OVER (
                            PARTITION BY employee_id
                            ORDER BY COUNT(*) DESC
                        ) as rn
                    FROM desktime_employee_data
                    WHERE work_starts != '00:00:00'
                      AND work_ends NOT IN ('00:00:00', '23:59:59')
                      AND work_ends > work_starts
                    GROUP BY employee_id, work_starts, work_ends
                ) ranked
                WHERE rn = 1
            ) sched ON r.employee_id = sched.employee_id
            WHERE 1=1
            $teamFilter";

    $rosterStmt = $pdo->prepare($rosterSql);
    $rosterStmt->execute();
    $rosterRows = $rosterStmt->fetchAll(PDO::FETCH_ASSOC);

    // Weekday-pattern forecast: for each roster employee, find the typical shift (or
    // "OFF") for EACH day of the week using their last 6 weeks (42 days) of history,
    // instead of one shift applied to every future day regardless of weekday. Falls
    // back to the all-time mode above (tier 2) when a weekday has too few recent samples.
    $rosterIds = array_column($rosterRows, 'employee_id');
    $weekdayPattern = [];
    $isoWeekday = function ($dateStr) {
        return (int) (new DateTime($dateStr))->format('N'); // 1 = Monday ... 7 = Sunday
    };

    if (!empty($rosterIds)) {
        $idPlaceholders = implode(',', array_map('intval', $rosterIds));

        // 42 days = exactly 6 occurrences of every weekday.
        $lookbackEnd = date('Y-m-d', strtotime('-1 day'));
        $lookbackStart = date('Y-m-d', strtotime('-42 days'));

        // Raw history rows, no team joins: roster ids are already team-filtered, and
        // joining org_team_assignments here could fan out (an employee can belong to
        // more than one team) and double-count a day in the tally below.
        $historyStmt = $pdo->prepare("
            SELECT employee_id, log_date, work_starts, work_ends
            FROM desktime_employee_data
            WHERE log_date BETWEEN :lookbackStart AND :lookbackEnd
              AND employee_id IN ($idPlaceholders)
            ORDER BY log_date ASC, work_starts ASC
        ");
        $historyStmt->execute(['lookbackStart' => $lookbackStart, 'lookbackEnd' => $lookbackEnd]);
        $historyRows = $historyStmt->fetchAll(PDO::FETCH_ASSOC);

        $firstSeenStmt = $pdo->prepare("
            SELECT employee_id, MIN(log_date) as first_seen
            FROM desktime_employee_data
            WHERE employee_id IN ($idPlaceholders)
            GROUP BY employee_id
        ");
        $firstSeenStmt->execute();
        $firstSeen = [];
        foreach ($firstSeenStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $firstSeen[$row['employee_id']] = $row['first_seen'];
        }

        // Collapse to one signature per employee+date: a valid shift, or 'OFF'.
        // Rows are ordered log_date ASC, work_starts ASC, so if two DeskTime accounts
        // (api_account) produced two rows for the same employee+date, the first valid
        // shift encountered wins deterministically over a later 'OFF'/invalid row.
        $daySignature = [];
        foreach ($historyRows as $row) {
            $id = $row['employee_id'];
            $date = $row['log_date'];
            $isValidShift = $row['work_starts'] !== '00:00:00'
                && !in_array($row['work_ends'], ['00:00:00', '23:59:59'], true)
                && $row['work_ends'] > $row['work_starts'];

            if ($isValidShift) {
                $daySignature[$id][$date] = $row['work_starts'] . '|' . $row['work_ends'];
            } elseif (!isset($daySignature[$id][$date])) {
                $daySignature[$id][$date] = 'OFF';
            }
        }

        // Every date in the lookback window, grouped by ISO weekday (1=Mon..7=Sun).
        $weekdayDates = [];
        $period = new DatePeriod(new DateTime($lookbackStart), new DateInterval('P1D'), (new DateTime($lookbackEnd))->modify('+1 day'));
        foreach ($period as $day) {
            $dateStr = $day->format('Y-m-d');
            $weekdayDates[$isoWeekday($dateStr)][] = $dateStr;
        }

        $MIN_PATTERN_SAMPLES = 2;

        foreach ($rosterIds as $id) {
            $employeeFirstSeen = $firstSeen[$id] ?? null;
            for ($weekday = 1; $weekday <= 7; $weekday++) {
                $tally = []; // signature => ['count' => n, 'lastDate' => 'Y-m-d']
                foreach ($weekdayDates[$weekday] ?? [] as $date) {
                    if ($employeeFirstSeen !== null && $date < $employeeFirstSeen) {
                        continue; // don't count pre-hire calendar days as evidence of OFF
                    }
                    $signature = $daySignature[$id][$date] ?? 'OFF';
                    if (!isset($tally[$signature])) {
                        $tally[$signature] = ['count' => 0, 'lastDate' => null];
                    }
                    $tally[$signature]['count']++;
                    $tally[$signature]['lastDate'] = $date; // dates visited oldest->newest
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
                    continue; // not enough recent evidence, let tier-2 fallback handle it
                }

                $weekdayPattern[$id][$weekday] = $bestSignature; // 'OFF' or 'start|end'
            }
        }
    }

    // Manual forecast overrides (tier 0): an admin can pin a specific historical week
    // as the source pattern for a roster employee, applied per weekday to future weeks
    // up to a chosen end week. Takes priority over the automatic tiers 1/2/3 below, but
    // never over real synced data (see the "isset($emp['schedules'][$dateStr])" guard
    // in the fill loop further down).
    $weekMondayOf = function ($dateStr) {
        $d = new DateTime($dateStr);
        $weekday = (int) $d->format('N'); // 1 = Monday ... 7 = Sunday
        $d->modify('-' . ($weekday - 1) . ' days');
        return $d->format('Y-m-d');
    };

    $overrides = [];
    $overrideSignature = [];
    if (!empty($rosterIds)) {
        $overrideStmt = $pdo->prepare("
            SELECT employee_id, source_week_start, target_end_week_start, pattern
            FROM org_schedule_forecast_overrides
            WHERE employee_id IN ($idPlaceholders)
        ");
        $overrideStmt->execute();
        foreach ($overrideStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $overrides[$row['employee_id']] = $row;
        }

        foreach ($overrides as $empId => $override) {
            // Seed all 7 weekdays as OFF first so a missing weekday doesn't silently
            // fall through to tier 1/2/3.
            for ($weekday = 1; $weekday <= 7; $weekday++) {
                $overrideSignature[$empId][$weekday] = 'OFF';
            }

            $pattern = $override['pattern'] ? json_decode($override['pattern'], true) : null;

            if ($pattern) {
                // The pattern was captured (and possibly hand-edited) at save time in
                // Forecast Settings — use it directly instead of re-reading DeskTime data.
                foreach ($pattern as $weekday => $signature) {
                    $overrideSignature[$empId][(int) $weekday] = $signature;
                }
                continue;
            }

            // Backward-compat fallback for overrides saved before the pattern column
            // existed: re-derive the signature live from that source week's synced data.
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
                $weekday = $isoWeekday($row['log_date']);
                if (isset($seenWeekdays[$weekday])) {
                    continue; // first row wins if a day has 2 rows (e.g. two DeskTime accounts)
                }
                $seenWeekdays[$weekday] = true;

                $isValidShift = $row['work_starts'] !== '00:00:00'
                    && !in_array($row['work_ends'], ['00:00:00', '23:59:59'], true)
                    && $row['work_ends'] > $row['work_starts'];

                $overrideSignature[$empId][$weekday] = $isValidShift
                    ? ($row['work_starts'] . '|' . $row['work_ends'])
                    : 'OFF';
            }
        }
    }

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
            'schedules' => [],
            '_predicted' => ($row['predicted_start'] && $row['predicted_end']) ? [
                'start' => $row['predicted_start'],
                'end' => $row['predicted_end']
            ] : null
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
                'schedules' => [],
                '_predicted' => null
            ];
        }
        $pivot[$id]['schedules'][$row['log_date']] = [
            'start' => $row['work_starts'],
            'end' => $row['work_ends']
        ];
    }

    // Fill future days that have no synced schedule yet with the employee's typical
    // shift for that specific weekday (tier 1: last 6 weeks, see $weekdayPattern
    // above), falling back to their all-time most common shift (tier 2: $emp['_predicted'])
    // when the weekday pattern couldn't be resolved. Flagged as a prediction, not a
    // confirmed schedule.
    $requestPeriod = new DatePeriod(new DateTime($from), new DateInterval('P1D'), (new DateTime($to))->modify('+1 day'));
    $futureDates = [];
    foreach ($requestPeriod as $day) {
        $dateStr = $day->format('Y-m-d');
        if ($dateStr > $today) {
            $futureDates[] = $dateStr;
        }
    }

    // Holidays in range, resolved per team. org_holidays.holiday_type is the org-wide
    // default and org_team_holiday_types holds only the teams that disagree (Employees >
    // Teams > Assign Members > Holidays), so the same date can close one team and not
    // another. Resolved in PHP rather than joined into the roster query because
    // org_holidays is unique per (country_code, holiday_date) — two countries sharing a
    // date would duplicate every roster row.
    $stmt = $pdo->prepare("SELECT id, holiday_date, holiday_type FROM org_holidays WHERE holiday_date BETWEEN :from AND :to");
    $stmt->execute(['from' => $from, 'to' => $to]);
    $holidaysInRange = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmt = $pdo->prepare("SELECT tht.team_id, tht.holiday_id, tht.holiday_type, tht.exclude_from, tht.exclude_to
                           FROM org_team_holiday_types tht
                           INNER JOIN org_holidays oh ON oh.id = tht.holiday_id
                           WHERE oh.holiday_date BETWEEN :from AND :to");
    $stmt->execute(['from' => $from, 'to' => $to]);
    $holidayOverrides = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $holidayOverrides[(int) $row['team_id']][(int) $row['holiday_id']] = $row;
    }

    // True when any holiday on that date is non_working for this team. An unassigned
    // employee (team_id null) has no overrides and simply follows the org default.
    $isNonWorkingFor = function ($teamId, $dateStr) use ($holidaysInRange, $holidayOverrides) {
        foreach ($holidaysInRange as $holiday) {
            if ($holiday['holiday_date'] !== $dateStr) {
                continue;
            }
            $effective = $holidayOverrides[$teamId][(int) $holiday['id']]['holiday_type'] ?? $holiday['holiday_type'];
            if ($effective === 'non_working') {
                return true;
            }
        }
        return false;
    };

    // The Custom (`campaign_defined`) window this team discounts on that date, if any.
    // Merged with MIN/MAX when two holidays share a date, matching the Run Rate query.
    $campaignExclusionFor = function ($teamId, $dateStr) use ($holidaysInRange, $holidayOverrides) {
        $from = null;
        $to = null;
        foreach ($holidaysInRange as $holiday) {
            if ($holiday['holiday_date'] !== $dateStr) {
                continue;
            }
            $override = $holidayOverrides[$teamId][(int) $holiday['id']] ?? null;
            if (!$override || $override['holiday_type'] !== 'campaign_defined') {
                continue;
            }
            if (empty($override['exclude_from']) || empty($override['exclude_to'])) {
                continue;
            }
            $from = $from === null ? $override['exclude_from'] : min($from, $override['exclude_from']);
            $to = $to === null ? $override['exclude_to'] : max($to, $override['exclude_to']);
        }
        return $from !== null ? ['from' => $from, 'to' => $to] : null;
    };

    // Trims a predicted shift by the excluded window. Only the part of the shift that
    // survives is forecast, so the board shows what the team is actually expected to work.
    // Returns null when nothing survives (the exclusion swallows the whole shift), and
    // leaves the shift untouched when the exclusion sits entirely outside it or would cut
    // a hole in the middle — a shift cannot be split into two blocks here, so the longer
    // remaining side wins.
    $clipShift = function ($start, $end, $exclusion) {
        if (!$exclusion) {
            return [$start, $end];
        }
        $s = strtotime("1970-01-01 $start");
        $e = strtotime("1970-01-01 $end");
        $xs = strtotime('1970-01-01 ' . $exclusion['from']);
        $xe = strtotime('1970-01-01 ' . $exclusion['to']);

        if ($xe <= $s || $xs >= $e) {
            return [$start, $end]; // no overlap
        }
        if ($xs <= $s && $xe >= $e) {
            return null; // fully excluded
        }
        $leftSecs = max(0, $xs - $s);
        $rightSecs = max(0, $e - $xe);
        if ($leftSecs >= $rightSecs) {
            return [$start, date('H:i:s', $xs)];
        }
        return [date('H:i:s', $xe), $end];
    };

    foreach ($pivot as $id => &$emp) {
        $tier2 = $emp['_predicted'];
        $override = $overrides[$id] ?? null;
        foreach ($futureDates as $dateStr) {
            if (isset($emp['schedules'][$dateStr])) {
                continue;
            }

            // Highest priority: a non-working holiday closes the day for this team, so it
            // outranks even a manual forecast override — nobody is scheduled when the
            // team is closed.
            if ($isNonWorkingFor($emp['_team_id'], $dateStr)) {
                $emp['schedules'][$dateStr] = [
                    'start' => '00:00:00',
                    'end' => '00:00:00',
                    'predicted' => true,
                    'holiday' => true
                ];
                continue;
            }

            $weekday = $isoWeekday($dateStr);
            $exclusion = $campaignExclusionFor($emp['_team_id'], $dateStr);

            // Writes a predicted shift with the team's Custom window removed. The board
            // forecasts scheduled time, which is the side that window applies to, so it
            // stays in step with the Run Rate. A shift left with nothing becomes OFF.
            $setShift = function ($start, $end, $extra) use (&$emp, $dateStr, $exclusion, $clipShift) {
                $clipped = $clipShift($start, $end, $exclusion);
                if ($clipped === null) {
                    $emp['schedules'][$dateStr] = ['start' => '00:00:00', 'end' => '00:00:00', 'predicted' => true]
                        + $extra + ['holiday' => true];
                    return;
                }
                $entry = ['start' => $clipped[0], 'end' => $clipped[1], 'predicted' => true] + $extra;
                if ($exclusion && $clipped !== [$start, $end]) {
                    $entry['holiday'] = true;
                }
                $emp['schedules'][$dateStr] = $entry;
            };

            // Tier 0: manual override, only while the date's week is within the
            // admin-chosen range.
            if ($override && $weekMondayOf($dateStr) <= $override['target_end_week_start']) {
                $signature = $overrideSignature[$id][$weekday] ?? 'OFF';
                if ($signature === 'OFF') {
                    $emp['schedules'][$dateStr] = [
                        'start' => '00:00:00',
                        'end' => '00:00:00',
                        'predicted' => true,
                        'manualOverride' => true
                    ];
                } else {
                    [$start, $end] = explode('|', $signature);
                    $setShift($start, $end, ['manualOverride' => true]);
                }
                continue;
            }

            $signature = $weekdayPattern[$id][$weekday] ?? null;

            if ($signature === 'OFF') {
                $emp['schedules'][$dateStr] = [
                    'start' => '00:00:00',
                    'end' => '00:00:00',
                    'predicted' => true
                ];
            } elseif ($signature !== null) {
                [$start, $end] = explode('|', $signature);
                $setShift($start, $end, []);
            } elseif ($tier2) {
                $setShift($tier2['start'], $tier2['end'], []);
            }
        }
        unset($emp['_predicted'], $emp['_team_id']);
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
