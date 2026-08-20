<?php
/**
 * get_schedule_board.php
 * Read-only endpoint to fetch employee schedules for a week.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'ShiftSchedulePatterns.php';

try {
    session_start();
    $isRestricted = isset($_SESSION['allowed_teams']) && !empty($_SESSION['allowed_teams']) && $_SESSION['role_name'] !== 'Admin';
    $allowedTeams = $isRestricted ? $_SESSION['allowed_teams'] : [];
    $teamFilter = $isRestricted ? " AND ota.team_id IN (" . implode(',', array_map('intval', $allowedTeams)) . ") " : "";

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

    // Tier 2 of the forecast: each employee's all-time most used shift. It is the one
    // aggregate here that no index can serve — it groups by (employee_id, work_starts,
    // work_ends) over the whole table, with no date bound — so roster mode, which never
    // projects anything, leaves it out entirely.
    $predictedColumns = $rosterOnly
        ? "NULL as predicted_start, NULL as predicted_end"
        : "sched.work_starts as predicted_start, sched.work_ends as predicted_end";

    $predictedJoin = $rosterOnly ? "" : "
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
                      $employeeFilterBare
                    GROUP BY employee_id, work_starts, work_ends
                ) ranked
                WHERE rn = 1
            ) sched ON r.employee_id = sched.employee_id";

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
                $predictedColumns
            FROM (
                SELECT d.employee_id, d.name, d.group_name
                FROM desktime_employee_data d
                INNER JOIN (
                    SELECT employee_id, MAX(log_date) as max_log_date
                    FROM desktime_employee_data
                    WHERE 1=1 $employeeFilterBare
                    GROUP BY employee_id
                    -- Each employee's own latest sync date, as long as it's within a few
                    -- days of the newest data in the whole table. Using a single global
                    -- MAX(log_date) here (like the old query did) wrongly drops anyone
                    -- whose sync simply landed a day later than everyone else's; but with
                    -- no floor at all, employees who stopped syncing months ago would flood
                    -- the roster too (confirmed: a steep drop-off after ~1 day behind).
                    HAVING MAX(log_date) >= (SELECT DATE_SUB(MAX(log_date), INTERVAL 3 DAY) FROM desktime_employee_data)
                ) latest ON latest.employee_id = d.employee_id AND latest.max_log_date = d.log_date
                WHERE 1=1 $employeeFilter
            ) r
            LEFT JOIN org_team_assignments ota ON r.employee_id = ota.employee_id
            LEFT JOIN org_teams ot ON ota.team_id = ot.id
            $predictedJoin
            WHERE 1=1
            $teamFilter";

    $rosterStmt = $pdo->prepare($rosterSql);
    $rosterStmt->execute();
    $rosterRows = $rosterStmt->fetchAll(PDO::FETCH_ASSOC);

    // Everything past this point projects schedules. Roster mode wants none of it, and
    // answers with the same {id, name, team} shape the full response carries so a caller
    // can read either one with the same code.
    if ($rosterOnly) {
        $roster = array_map(function ($row) {
            return [
                'id' => (int) $row['employee_id'],
                'name' => $row['name'],
                'team' => $row['team_name'],
                'lunch_time' => $row['team_lunch'] ?? 0
            ];
        }, $rosterRows);
        usort($roster, function ($a, $b) {
            return strcasecmp($a['name'], $b['name']);
        });

        echo json_encode(['success' => true, 'roster' => true, 'data' => $roster]);
        exit;
    }

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
    $pastDates = [];
    foreach ($requestPeriod as $day) {
        $dateStr = $day->format('Y-m-d');
        if ($dateStr > $today) {
            $futureDates[] = $dateStr;
        } else {
            $pastDates[] = $dateStr;
        }
    }

    // Holidays in range, resolved per team. org_holidays.holiday_type is the org-wide
    // default and org_team_holiday_types holds only the teams that disagree (Employees >
    // Teams > Assign Members > Holidays), so the same date can close one team and not
    // another. Resolved in PHP rather than joined into the roster query because
    // org_holidays is unique per (country_code, holiday_date) — two countries sharing a
    // date would duplicate every roster row.
    $stmt = $pdo->prepare("SELECT id, name, country_code, holiday_date, holiday_type FROM org_holidays WHERE holiday_date BETWEEN :from AND :to");
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


    // Every holiday governing this team on a date — plural, because org_holidays is unique
    // per (country_code, holiday_date), so the same day can carry one row per country. Each
    // carries the type the team itself gave it, so the board can show the same date as
    // Non-Working for one employee and Working for another.
    $holidaysFor = function ($teamId, $dateStr) use ($holidaysInRange, $holidayOverrides) {
        $found = [];
        foreach ($holidaysInRange as $holiday) {
            if ($holiday['holiday_date'] !== $dateStr) {
                continue;
            }
            $override = $holidayOverrides[$teamId][(int) $holiday['id']] ?? null;
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
    };

    // Shift Management's versioned weekly patterns. Two screens can now pin a future
    // schedule, so the order between them is fixed here: a Shift Management version whose
    // effective range covers the date wins, and the Configuration > Scheduling > Forecast
    // override only fills dates no version covers. Shift Management is the more specific
    // of the two — it names an explicit start and end date rather than a whole week.
    $shiftPatterns = fetchShiftPatternsForRange($pdo, $from, $to);

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
            $signature = resolveShiftSignature($versions, $dateStr);
            if ($signature === null) {
                continue;
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

    foreach ($pivot as $id => &$emp) {
        $tier2 = $emp['_predicted'];
        $override = $overrides[$id] ?? null;
        $employeeShiftVersions = $shiftPatterns[(int) $id] ?? [];
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
                    'predicted' => true
                ];
                continue;
            }

            $weekday = $isoWeekday($dateStr);

            // The shift is written unchanged, even on a Custom holiday. A Custom window is a
            // deduction from the hours that count, not a change to the person's schedule, so
            // the board keeps showing 8:00–17:00 and the hours maths subtracts the window
            // from it (shiftHours in ShiftCard.jsx). Keeping the two apart also means a
            // window cutting a hole in the middle of a shift no longer has to be
            // misrepresented as a shorter shift, which is what the old clipping did.
            $setShift = function ($start, $end, $extra) use (&$emp, $dateStr) {
                $emp['schedules'][$dateStr] = ['start' => $start, 'end' => $end, 'predicted' => true] + $extra;
            };

            // Tier 0a: a Shift Management version covering this date.
            $shiftSignature = resolveShiftSignature($employeeShiftVersions, $dateStr);
            if ($shiftSignature !== null) {
                if ($shiftSignature === 'OFF') {
                    $emp['schedules'][$dateStr] = [
                        'start' => '00:00:00',
                        'end' => '00:00:00',
                        'predicted' => true,
                        'manualOverride' => true
                    ];
                } else {
                    [$start, $end] = explode('|', $shiftSignature);
                    $setShift($start, $end, ['manualOverride' => true]);
                }
                continue;
            }

            // Tier 0b: manual forecast override, only while the date's week is within the
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
            $info = $holidaysFor($emp['_team_id'], $dateStr);
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
