<?php
/**
 * sync_auto_day.php
 *
 * The one-day unit of the automatic sync, plus the gap calculation that decides which
 * days need it. Shared by three callers that must agree exactly:
 *   - sync_status.php          (read-only: what is pending?)
 *   - sync_auto_background.php (HTTP: one day, driven by the app)
 *   - sync_auto_cli.php        (cron: every pending day, unattended)
 * They all write into desktime_sync_log, so the rules for claiming, completing and
 * skipping a day live here rather than being copied into each caller.
 */
require_once __DIR__ . '/sync_desktime_core.php';
require_once __DIR__ . '/sync_backfill_window.php';

if (!defined('AUTO_SYNC_LOCK')) {
    define('AUTO_SYNC_LOCK', 'wfm_auto_sync');
}

/** Creates the log table and applies the column migrations it has accumulated. */
function autoSyncEnsureLogTable(PDO $pdo)
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS desktime_sync_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sync_date DATE NOT NULL,
        status ENUM('success', 'failure', 'skipped') NOT NULL,
        hours_updated INT DEFAULT 0,
        projects_updated INT DEFAULT 0,
        error_message TEXT,
        sync_type ENUM('manual', 'automatic') DEFAULT 'automatic',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (sync_date)
    )");

    // Ensure sync_type column exists if table was already created
    $stmt = $pdo->query("SHOW COLUMNS FROM desktime_sync_log LIKE 'sync_type'");
    if (!$stmt->fetch()) {
        $pdo->exec("ALTER TABLE desktime_sync_log ADD COLUMN sync_type ENUM('manual', 'automatic') DEFAULT 'automatic' AFTER error_message");
    }

    // A day is claimed before the crawl starts, so the enum needs a value for "started but
    // not finished". Without it, a request that died mid-crawl left no trace at all: the
    // log row used to be written only at the very end.
    // Appended rather than restated: see syncEnumEnsureValue() for what restating the list
    // did to sync_type in production.
    syncEnumEnsureValue($pdo, 'desktime_sync_log', 'status', 'running');

    // The weekly job's 'weekly' sync_type is added by weeklyHoursEnsureLogType(), on the
    // weekly path only, so a failure there can never block this daily one.
}

/**
 * Normalises a caller-supplied date and rejects anything the automatic sync must not
 * touch: today (still in progress), the future, and days older than the backfill window.
 */
function autoSyncValidateDate($date)
{
    $yesterday = date('Y-m-d', strtotime('-1 day'));
    $date = trim((string) $date);

    $parsed = DateTime::createFromFormat('Y-m-d', $date);
    if (!$parsed || $parsed->format('Y-m-d') !== $date) {
        throw new Exception("Invalid date: expected YYYY-MM-DD");
    }
    // Today is still in progress and tomorrow does not exist; either would write a row
    // that later runs have no reason to correct.
    if ($date > $yesterday) {
        throw new Exception("Cannot auto-sync {$date}: only days up to {$yesterday} are allowed");
    }
    $earliest = autoSyncEarliestDate($yesterday);
    if ($date < $earliest) {
        throw new Exception("Date {$date} is older than the " . AUTO_SYNC_MAX_BACKFILL_DAYS . "-day automatic window (from {$earliest}); use Save Hours / Save Projects");
    }
    return $date;
}

/**
 * True when a previous automatic run carried this day to completion.
 *
 * The old check also demanded projects_updated > 0, so a legitimately empty day (a
 * weekend, a holiday) never counted as done and was re-crawled on every app open. The
 * 'automatic' condition still stands: a manual Save Hours logs 'manual' with no project
 * data, and must not be taken as marking the day complete.
 */
function autoSyncIsDayComplete(PDO $pdo, $date)
{
    $stmt = $pdo->prepare("SELECT id FROM desktime_sync_log
                           WHERE sync_date = ? AND status = 'success' AND sync_type = 'automatic'
                           LIMIT 1");
    $stmt->execute([$date]);
    return (bool) $stmt->fetch();
}

/**
 * Every logged-in user's browser fires the sync, so without this lock three people
 * arriving at 8 AM would start three concurrent crawls against DeskTime -- and bursts are
 * exactly what trips its rate limit, which comes back looking identical to an auth
 * failure (see sync_desktime_core.php). Timeout 0 so a loser reports back at once instead
 * of holding a request open.
 */
function autoSyncAcquireLock(PDO $pdo)
{
    $stmt = $pdo->prepare("SELECT GET_LOCK(?, 0) AS got");
    $stmt->execute([AUTO_SYNC_LOCK]);
    $lock = $stmt->fetch(PDO::FETCH_ASSOC);
    return !empty($lock['got']);
}

function autoSyncReleaseLock(PDO $pdo)
{
    $pdo->prepare("SELECT RELEASE_LOCK(?)")->execute([AUTO_SYNC_LOCK]);
}

/**
 * Holding the lock means nothing else can legitimately be mid-run, so any row still
 * marked 'running' is debris from a request that died (timeout, closed tab). Call this
 * right after acquiring the lock so leftovers surface as failures in Sync History instead
 * of accumulating -- and so the day they belong to is retried rather than looking done.
 */
function autoSyncClearStaleRuns(PDO $pdo)
{
    $pdo->exec("UPDATE desktime_sync_log
                SET status = 'failure',
                    error_message = CONCAT(COALESCE(error_message, ''), ' | Interrumpido (timeout o navegador cerrado)')
                WHERE status = 'running'");
}

/**
 * Records the attempt before any work happens, so a crash leaves evidence behind.
 *
 * The claim also registers a shutdown guard, because "the process dies mid-crawl" is not
 * hypothetical: the first real run (2026-09-16, day 2026-09-14) was killed by
 * max_execution_time one second short of finishing and left its row at 'running' forever.
 * Shutdown functions still run after a timeout or a fatal, so this is the last chance to
 * record what happened. The UPDATE is conditional on the row still being 'running', which
 * makes it a no-op on the normal path where autoSyncCloseDay already closed it.
 */
function autoSyncClaimDay(PDO $pdo, $date)
{
    $stmt = $pdo->prepare("INSERT INTO desktime_sync_log
        (sync_date, status, hours_updated, projects_updated, error_message, sync_type)
        VALUES (?, 'running', 0, 0, '', 'automatic')");
    $stmt->execute([$date]);
    $logId = $pdo->lastInsertId();

    register_shutdown_function(function () use ($pdo, $logId, $date) {
        try {
            $error = error_get_last();
            $reason = ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true))
                ? substr($error['message'], 0, 300)
                : 'El proceso termino sin cerrar el dia (timeout, fatal o conexion abortada)';

            $stmt = $pdo->prepare("UPDATE desktime_sync_log
                                   SET status = 'failure', error_message = ?
                                   WHERE id = ? AND status = 'running'");
            $stmt->execute(["{$date}: {$reason}", $logId]);
        } catch (Exception $e) {
            // Nothing useful left to do this late in the request.
        }
    });

    return $logId;
}

/**
 * The actual work for one day: Core Hours (what Save Hours does) into
 * desktime_employee_data, then the per-employee project crawl into desktime_project_data.
 * Returns counts plus two separate error lists -- account-level failures fail the day,
 * row-level losses are only reported.
 */
function autoSyncRunDay(PDO $pdo, array $env, $date)
{
    $projectsCount = 0;

    // 1. Sync Core Hours (Save Hours). The fold that turns the per-account result into
    // counts and the two error lists is shared with sync_desktime_range.php and the weekly
    // job -- see syncSummarizeHourResults() in sync_desktime_core.php.
    $hoursSummary = syncSummarizeHourResults(syncDeskTime($pdo, $env, $date));
    $hoursCount = $hoursSummary['hours'];
    $errors = $hoursSummary['errors'];
    $rowErrors = $hoursSummary['row_errors'];

    // 2. Sync Project Data (Employee Project Report)
    // Using optimized single-day logic
    // Every configured account (Configuration > Desktime API, else .env).
    $accounts = desktimeAccounts($env);

    foreach ($accounts as $accName => $apiKey) {
        if (!$apiKey) continue;

        // Fetch employees specifically for the target day
        $empUrl = "https://desktime.com/api/v2/json/employees?apiKey=" . urlencode($apiKey) . "&date=" . urlencode($date);
        $ch = curl_init($empUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        $empRes = curl_exec($ch);
        curl_close($ch);
        $empResArr = json_decode($empRes, true);
        if (!isset($empResArr['employees'])) {
            // Skipping this silently left the day looking complete with zero projects, and a
            // completed day is never revisited. Fail the day so it gets retried instead.
            $errors[] = "Projects ({$accName}): employee list unavailable";
            continue;
        }

        $employeesToProcess = $empResArr['employees'];
        // Robustly find the employee list (handles date-keyed or direct list)
        reset($employeesToProcess);
        $firstKey = key($employeesToProcess);
        if ($firstKey && preg_match('/^\d{4}-\d{2}-\d{2}$/', $firstKey)) {
            $employeesToProcess = $employeesToProcess[$firstKey];
        }

        foreach ($employeesToProcess as $empKey => $emp) {
            $eData = is_array($emp) ? $emp : [];
            $realEmpId = $eData['id'] ?? $empKey;

            if (!is_numeric($realEmpId)) continue;

            $projUrl = "https://desktime.com/api/v2/json/employee/projects?apiKey=" . urlencode($apiKey) . "&id=" . urlencode($realEmpId) . "&date=" . urlencode($date);
            $chP = curl_init($projUrl);
            curl_setopt($chP, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($chP, CURLOPT_SSL_VERIFYPEER, false);
            $projRes = curl_exec($chP);
            curl_close($chP);

            $projData = json_decode($projRes, true);
            if (isset($projData['projects']) && is_array($projData['projects'])) {
                foreach ($projData['projects'] as $proj) {
                    $sql = "INSERT INTO desktime_project_data
                            (employee_id, employee_name, email, team_name, project_id, project_title, task_id, task_title, duration_seconds, log_date, api_account)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE
                            duration_seconds = VALUES(duration_seconds),
                            employee_name = VALUES(employee_name),
                            team_name = VALUES(team_name),
                            project_title = VALUES(project_title),
                            task_title = VALUES(task_title)";

                    $stmt = $pdo->prepare($sql);
                    $stmt->execute([
                        $realEmpId,
                        $projData['name'] ?? ($eData['name'] ?? 'Unknown'),
                        $projData['email'] ?? ($eData['email'] ?? ''),
                        $projData['group'] ?? ($eData['group'] ?? 'Unassigned'),
                        $proj['project_id'] ?? 0,
                        $proj['project_title'] ?? '',
                        $proj['task_id'] ?? 0,
                        $proj['task_title'] ?? '',
                        $proj['duration'] ?? 0,
                        $date,
                        $accName
                    ]);
                    $projectsCount++;
                }
            }
        }
    }

    return [
        'hours' => $hoursCount,
        'projects' => $projectsCount,
        'errors' => $errors,
        'row_errors' => $rowErrors
    ];
}

/**
 * Closes out a claimed row. Status reflects account-level failures only; row losses are
 * surfaced in the message so a partial sync never shows up as a clean SUCCESS. A day that
 * finishes with zero projects is still a success -- that is exactly what a weekend looks
 * like, and marking it done is what stops it being re-crawled on every login.
 */
function autoSyncCloseDay(PDO $pdo, $logId, array $result)
{
    $status = empty($result['errors']) ? 'success' : 'failure';
    $allMessages = array_merge($result['errors'], $result['row_errors']);

    $stmt = $pdo->prepare("UPDATE desktime_sync_log
                           SET status = ?, hours_updated = ?, projects_updated = ?, error_message = ?
                           WHERE id = ?");
    $stmt->execute([
        $status,
        $result['hours'],
        $result['projects'],
        implode(' | ', $allMessages),
        $logId
    ]);

    return $status;
}

/**
 * Which days still need the automatic sync.
 *
 * "Pending" is the gap between the last day desktime_project_data actually holds and
 * yesterday, minus the days a previous automatic run already finished. That second half
 * is not optional: a Saturday with no tracked projects inserts no rows at all, so
 * MAX(log_date) never advances past it, and without the completed-days set the same day
 * would be re-crawled on every single app open, forever.
 */
function autoSyncPendingDays(PDO $pdo)
{
    $yesterday = date('Y-m-d', strtotime('-1 day'));
    // Inclusive window: yesterday plus the days before it, AUTO_SYNC_MAX_BACKFILL_DAYS total.
    $earliest = autoSyncEarliestDate($yesterday);

    // Anchored on the last day at or before yesterday, never on the plain MAX: Save Projects
    // defaults to today, so a run for today would otherwise push the anchor past yesterday,
    // collapse the range to nothing and skip a genuinely missing yesterday in silence.
    $lastProjectDate = null;
    if (syncTableExists($pdo, 'desktime_project_data')) {
        $stmt = $pdo->prepare("SELECT MAX(log_date) AS last_date FROM desktime_project_data WHERE log_date <= ?");
        $stmt->execute([$yesterday]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $lastProjectDate = $row['last_date'] ?? null;
    }

    // Start the day after the last day we hold project data for. An empty table gives no
    // anchor at all, so fall back to the window floor instead of the beginning of time.
    $start = $lastProjectDate
        ? date('Y-m-d', strtotime($lastProjectDate . ' +1 day'))
        : $earliest;

    // A gap of months must not turn a login into an hours-long crawl -- the project step
    // costs one HTTP request per employee per day. Anything older than the window stays the
    // job of Save Hours / Save Projects, and 'truncated' lets the caller say so.
    $truncated = false;
    if ($start < $earliest) {
        $start = $earliest;
        $truncated = true;
    }

    $candidates = [];
    for ($d = $start; $d <= $yesterday; $d = date('Y-m-d', strtotime($d . ' +1 day'))) {
        $candidates[] = $d;
    }

    // Days whose automatic run started and never succeeded have to come back even when they
    // sit behind the anchor. A run killed part-way still writes rows, which drags MAX(log_date)
    // forward, so the anchor alone declares a half-finished day done: that is exactly how
    // 2026-09-14 ended up with a complete TN and a truncated BAY on 2026-09-16, with the
    // anchor sitting on top of it. The log knows the day never closed; the anchor cannot.
    if (syncTableExists($pdo, 'desktime_sync_log')) {
        $stmt = $pdo->prepare("SELECT DISTINCT sync_date FROM desktime_sync_log
                               WHERE sync_date BETWEEN ? AND ?
                                 AND sync_type = 'automatic'
                                 AND sync_date NOT IN (
                                     SELECT sync_date FROM (
                                         SELECT sync_date FROM desktime_sync_log
                                         WHERE sync_date BETWEEN ? AND ?
                                           AND sync_type = 'automatic' AND status = 'success'
                                     ) AS done
                                 )");
        $stmt->execute([$earliest, $yesterday, $earliest, $yesterday]);
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $retry) {
            $candidates[] = $retry;
        }
        $candidates = array_unique($candidates);
        sort($candidates);
    }

    $completed = [];
    if ($candidates && syncTableExists($pdo, 'desktime_sync_log')) {
        $stmt = $pdo->prepare("SELECT DISTINCT sync_date FROM desktime_sync_log
                               WHERE sync_date BETWEEN ? AND ?
                                 AND status = 'success'
                                 AND sync_type = 'automatic'");
        // $earliest, not $start: a retryable day can sit behind the anchor.
        $stmt->execute([$earliest, $yesterday]);
        $completed = $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    return [
        'pending' => array_values(array_diff($candidates, $completed)),
        'last_project_date' => $lastProjectDate,
        'yesterday' => $yesterday,
        'truncated' => $truncated
    ];
}
