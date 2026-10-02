<?php
/**
 * manage_shift_schedule.php
 * Scheduling > Shift Management: the employee's current weekly shift pattern, a preview of
 * what applying a change would do, and saving it as a new version.
 *
 * Patterns are resolved at read time by get_schedule_board.php — nothing is materialised
 * per date. Saving stores a new row in org_shift_schedule_patterns rather than overwriting,
 * so superseded schedules stay on record.
 *
 * GET    ?employee_id=N            -> employee summary, current week board data, versions
 * POST   {action:"preview", ...}   -> counts for the confirmation step, saves nothing
 * POST   {action:"apply", ...}     -> stores a new version
 * DELETE ?id=N                     -> removes one version
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'ShiftSchedulePatterns.php';
require_once 'EmployeeLunchTimes.php';

$method = $_SERVER['REQUEST_METHOD'];
$today = date('Y-m-d');

/** Dates DeskTime already has data for — the board never projects over these. */
function syncedDatesFor(PDO $pdo, int $employeeId, string $from, string $to): array
{
    $stmt = $pdo->prepare(
        "SELECT log_date FROM desktime_employee_data
         WHERE employee_id = ? AND log_date BETWEEN ? AND ?"
    );
    $stmt->execute([$employeeId, $from, $to]);
    return array_fill_keys($stmt->fetchAll(PDO::FETCH_COLUMN), true);
}

if ($method === 'GET') {
    $employeeId = isset($_GET['employee_id']) ? (int) $_GET['employee_id'] : null;
    if (!$employeeId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'employee_id is required']);
        exit;
    }

    try {
        // Identity comes from the employee's most recent synced row, which is also where
        // the board gets the name and team from.
        $stmt = $pdo->prepare(
            "SELECT d.employee_id, d.name, d.email, COALESCE(ot.name, d.group_name) AS team,
                    d.group_name AS campaign, COALESCE(ot.lunch_time, 0) AS lunch_time
             FROM desktime_employee_data d
             LEFT JOIN org_team_assignments ota ON ota.employee_id = d.employee_id
             LEFT JOIN org_teams ot ON ot.id = ota.team_id
             WHERE d.employee_id = ?
             ORDER BY d.log_date DESC
             LIMIT 1"
        );
        $stmt->execute([$employeeId]);
        $employee = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$employee) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Employee not found.']);
            exit;
        }

        // ISO weekday => minutes, holding only the days Employee Lunch Time gave this
        // person a lunch of their own. `lunch_time` above stays the team's, and the editor
        // falls back to it for every weekday absent here — so each day of the week can
        // deduct a different amount from its card.
        $employee['lunch_times'] = (object) (fetchEmployeeLunchTimes($pdo, [$employeeId])[$employeeId] ?? []);

        $versions = fetchShiftPatternVersions($pdo, $employeeId);

        // The pattern the editor opens on: the version covering today if there is one,
        // otherwise the newest one, otherwise the employee's most common historical shift
        // so the week starts from something real instead of blank.
        $current = null;
        foreach ($versions as $version) {
            if ($today >= $version['effective_start'] && $today <= $version['effective_end']) {
                $current = $version;
                break;
            }
        }
        if (!$current && !empty($versions)) {
            $current = $versions[0];
        }

        $stmt = $pdo->prepare(
            "SELECT work_starts, work_ends, COUNT(*) AS uses
             FROM desktime_employee_data
             WHERE employee_id = ?
               AND work_starts != '00:00:00'
               AND work_ends NOT IN ('00:00:00', '23:59:59')
               AND work_ends > work_starts
             GROUP BY work_starts, work_ends
             ORDER BY uses DESC
             LIMIT 1"
        );
        $stmt->execute([$employeeId]);
        $typical = $stmt->fetch(PDO::FETCH_ASSOC);

        echo json_encode([
            'success' => true,
            'employee' => $employee,
            'current_version' => $current,
            'versions' => $versions,
            'typical_shift' => $typical
                ? ['start' => $typical['work_starts'], 'end' => $typical['work_ends']]
                : null,
            // So the editor can warn that a forecast from Configuration > Scheduling >
            // Forecast is currently governing this employee's future days.
            'forecast_override' => fetchForecastOverride($pdo, $employeeId),
            'today' => $today
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $action = $data['action'] ?? '';
    $employeeId = isset($data['employee_id']) ? (int) $data['employee_id'] : null;
    $employeeName = trim((string) ($data['employee_name'] ?? ''));
    $effectiveStart = $data['effective_start'] ?? null;
    $effectiveEnd = $data['effective_end'] ?? null;
    $pattern = $data['pattern'] ?? null;
    // Optional: the week the seven cards were read from. Absent on any client that has not
    // been updated, which stays valid — the column is nullable.
    $sourceWeekStart = $data['source_week_start'] ?? null;

    if (!in_array($action, ['preview', 'apply'], true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'action must be "preview" or "apply"']);
        exit;
    }
    if (!$employeeId || $effectiveStart === null || $effectiveEnd === null || $pattern === null) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => 'employee_id, effective_start, effective_end and pattern are required'
        ]);
        exit;
    }

    try {
        foreach (['effective_start' => $effectiveStart, 'effective_end' => $effectiveEnd] as $label => $value) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $value)) {
                throw new InvalidArgumentException("$label must be a YYYY-MM-DD date.");
            }
        }
        if ($effectiveEnd < $effectiveStart) {
            throw new InvalidArgumentException('Apply Until cannot be earlier than Effective Start.');
        }
        // Normalised to its Monday rather than trusted: the column names a week, so a
        // mid-week date from any caller would otherwise be stored as if it were one.
        if ($sourceWeekStart !== null && $sourceWeekStart !== '') {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $sourceWeekStart)) {
                throw new InvalidArgumentException('source_week_start must be a YYYY-MM-DD date.');
            }
            $sourceWeekStart = shiftWeekMondayOf($sourceWeekStart);
        } else {
            $sourceWeekStart = null;
        }

        $cleanPattern = validateShiftPattern($pattern);
        $existingVersions = fetchShiftPatternVersions($pdo, $employeeId);
        $syncedDates = syncedDatesFor($pdo, $employeeId, $effectiveStart, $effectiveEnd);
        $forecastOverride = fetchForecastOverride($pdo, $employeeId);

        $summary = summarizeShiftPatternApply(
            $cleanPattern,
            $effectiveStart,
            $effectiveEnd,
            $today,
            $syncedDates,
            $existingVersions,
            $forecastOverride
        );

        // A manual forecast override left with no date of its own is deleted rather than
        // kept as a row that no longer governs anything — otherwise Configuration >
        // Scheduling > Forecast keeps listing it as active. When the new period only
        // partly covers it, it survives and read-time precedence handles the overlap.
        $forecastSuperseded = $forecastOverride !== null
            && forecastOverrideFullySuperseded($forecastOverride, $effectiveStart, $effectiveEnd, $today);

        $summary['forecast_override_present'] = $forecastOverride !== null;
        $summary['forecast_override_removed'] = $forecastSuperseded;

        if ($action === 'preview') {
            echo json_encode(['success' => true, 'preview' => $summary]);
            exit;
        }

        if ($summary['shifts'] === 0 && $summary['off_days'] === 0) {
            throw new InvalidArgumentException(
                'This period contains no day the schedule could apply to — every date in it is in the past with no recorded day.'
            );
        }
        if ($employeeName === '') {
            throw new InvalidArgumentException('employee_name is required.');
        }

        // One transaction: the new version and the retirement of the forecast it supersedes
        // have to land together, or the board would briefly show one without the other.
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                "INSERT INTO org_shift_schedule_patterns
                    (employee_id, employee_name, effective_start, effective_end, pattern, source_week_start)
                 VALUES (?, ?, ?, ?, ?, ?)"
            );
            $stmt->execute([
                $employeeId,
                $employeeName,
                $effectiveStart,
                $effectiveEnd,
                json_encode($cleanPattern),
                $sourceWeekStart
            ]);
            $versionId = (int) $pdo->lastInsertId();

            if ($forecastSuperseded) {
                $pdo->prepare("DELETE FROM org_schedule_forecast_overrides WHERE employee_id = ?")
                    ->execute([$employeeId]);
            }

            $pdo->commit();
        } catch (Exception $e) {
            $pdo->rollBack();
            throw $e;
        }

        echo json_encode([
            'success' => true,
            'version_id' => $versionId,
            'applied' => $summary
        ]);
    } catch (InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : null;
    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'id is required']);
        exit;
    }
    try {
        $stmt = $pdo->prepare("DELETE FROM org_shift_schedule_patterns WHERE id = ?");
        $stmt->execute([$id]);
        echo json_encode(['success' => true, 'deleted' => $stmt->rowCount()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
?>
