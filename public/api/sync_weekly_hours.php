<?php
/**
 * sync_weekly_hours.php
 *
 * Syncs one full Monday-Sunday week of Core Hours -- what the Save Hours screen does, for
 * seven days -- and nothing else. No project data: that is the daily job's business
 * (sync_auto_background.php), and it costs one DeskTime request per employee per day,
 * which is exactly what makes it too expensive to re-run a whole week of.
 *
 * Hours are cheap by comparison: syncDeskTime() makes one request per account per day, so
 * a week is fourteen requests. The BAY account routinely takes ~11s, so budget ~100s for
 * the week -- long for a browser request, which is why the claim/close bookkeeping and
 * ignore_user_abort() below matter, but nothing like the daily crawl.
 *
 * Which week, and whether it runs at all, is decided entirely by sync_weekly_window.php
 * from the server clock. This endpoint deliberately takes no date parameter: the trigger
 * is "the app was opened on a Tue-Fri", fired by every logged-in browser, and letting a
 * caller name its own week would turn a fixed weekly job into an open backfill endpoint.
 * Backfilling an arbitrary range is Save Hours' job, through sync_desktime_range.php.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'sync_auto_day.php';       // the shared lock, and the sync log table/migrations
require_once 'sync_weekly_window.php';

// Same rule as sync_auto_background.php: the app fires this from the browser on every
// login, so it cannot be an open endpoint.
if (PHP_SAPI !== 'cli') {
    session_start();
    if (!isset($_SESSION['user_id'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Not authenticated']);
        exit;
    }
}

// Seven days at ~14s each, and on Windows max_execution_time counts the time spent inside
// curl. The daily job settled on 1800 for the same reason; a week of hours needs far less
// but there is no benefit to a ceiling that sits near the real runtime.
set_time_limit(1800);

// The week must finish and be recorded even if the user closes the tab. A week left at
// 'running' is recoverable (the next run clears it), but only after the retry window.
ignore_user_abort(true);

$lockAcquired = false;
$claimed = null;
$state = null;

try {
    // The runs table first: it is what a failure anywhere below gets recorded in, and
    // without a record there is no throttle.
    weeklyHoursEnsureRunsTable($pdo);

    $state = weeklyHoursState($pdo);

    if (!$state['due']) {
        echo json_encode([
            'success' => true,
            'status' => $state['reason'] === 'off_day' ? 'not_due' : $state['reason'],
            'week_start' => $state['target_week'],
            'week_end' => $state['week_end']
        ]);
        exit;
    }

    // Schema work only once the week is actually due, so the ordinary "nothing to do"
    // answer never touches a DDL statement.
    autoSyncEnsureLogTable($pdo);
    weeklyHoursEnsureLogType($pdo);

    // Shared with the daily job on purpose, not a lock of its own: both crawl the same two
    // DeskTime accounts, and simultaneous bursts are what trips the rate limit -- which
    // comes back looking identical to an auth failure (see sync_desktime_core.php).
    if (!autoSyncAcquireLock($pdo)) {
        echo json_encode([
            'success' => true,
            'status' => 'locked',
            'message' => 'Another sync is already running.',
            'week_start' => $state['target_week']
        ]);
        exit;
    }
    $lockAcquired = true;

    // Safe now that the lock is held: anything still 'running' is debris.
    weeklyHoursClearStaleRuns($pdo);

    // Re-read under the lock. Between the check above and here, another tab could have
    // finished this very week; without this, two users logging in together would both
    // crawl it.
    $state = weeklyHoursState($pdo);
    if (!$state['due']) {
        autoSyncReleaseLock($pdo);
        echo json_encode([
            'success' => true,
            'status' => $state['reason'] === 'off_day' ? 'not_due' : $state['reason'],
            'week_start' => $state['target_week'],
            'week_end' => $state['week_end']
        ]);
        exit;
    }

    $weekStart = $state['target_week'];
    $weekEnd = $state['week_end'];

    // The queue holds one week only. Anything older that never finished is dropped here
    // rather than carried forward, and reported so the UI can tell someone it now needs a
    // manual Save Hours.
    $dropped = weeklyHoursSupersedeOlder($pdo, $weekStart);

    weeklyHoursClaim($pdo, $weekStart, $weekEnd);
    $claimed = $weekStart;

    $totalHours = 0;
    $daysOk = 0;
    $weekMessages = [];
    $dayResults = [];

    $logStmt = $pdo->prepare("INSERT INTO desktime_sync_log
        (sync_date, status, hours_updated, projects_updated, error_message, sync_type)
        VALUES (?, ?, ?, 0, ?, 'weekly')");

    for ($i = 0; $i < 7; $i++) {
        $day = date('Y-m-d', strtotime($weekStart . " +{$i} days"));

        // The whole week is re-synced every time, including days the daily job already
        // covered. Re-running is idempotent (the upsert in syncDeskTime keys on employee +
        // log_date) and costs two requests, so the week ends up consistent instead of a
        // mosaic of whatever happened to be collected when.
        try {
            $summary = syncSummarizeHourResults(syncDeskTime($pdo, $env, $day));
        } catch (Exception $dayError) {
            // One bad day must not abort the rest of the week -- the remaining days are
            // independent API calls and there is no reason to lose them too.
            $message = "Hours ({$day}): " . $dayError->getMessage();
            $weekMessages[] = $message;
            $logStmt->execute([$day, 'failure', 0, substr($message, 0, 500)]);
            $dayResults[] = ['date' => $day, 'status' => 'failure', 'hours' => 0];
            continue;
        }

        $totalHours += $summary['hours'];

        // Status reflects account-level failures only; row losses are surfaced in the
        // message so a partial sync never shows up as a clean SUCCESS.
        $dayStatus = empty($summary['errors']) ? 'success' : 'failure';
        $dayMessages = array_merge($summary['errors'], $summary['row_errors']);

        if ($dayStatus === 'success') {
            $daysOk++;
        }
        foreach ($dayMessages as $message) {
            $weekMessages[] = "{$day} -- {$message}";
        }

        $logStmt->execute([$day, $dayStatus, $summary['hours'], substr(implode(' | ', $dayMessages), 0, 500)]);
        $dayResults[] = ['date' => $day, 'status' => $dayStatus, 'hours' => $summary['hours']];
    }

    $weekStatus = weeklyHoursClose($pdo, $weekStart, $daysOk, $weekMessages);
    $claimed = null; // closed out; the catch below must not overwrite it

    autoSyncReleaseLock($pdo);
    $lockAcquired = false;

    echo json_encode([
        'success' => true,
        'status' => $weekStatus === 'success' ? 'completed' : 'failed',
        'week_start' => $weekStart,
        'week_end' => $weekEnd,
        'days_ok' => $daysOk,
        'hours_synced' => $totalHours,
        'dropped_weeks' => $dropped,
        'errors' => $weekMessages,
        'days' => $dayResults
    ]);

} catch (Exception $e) {
    // A caught error must not leave the claimed week sitting at 'running'.
    if ($claimed) {
        try {
            $stmt = $pdo->prepare("UPDATE weekly_hours_runs
                                   SET status = 'failure', error_message = ?
                                   WHERE week_start = ? AND status = 'running'");
            $stmt->execute([substr($e->getMessage(), 0, 500), $claimed]);
        } catch (Exception $inner) {
            // Reporting the original failure matters more than recording it.
        }
    } elseif (!empty($state['due'])) {
        // Failed before the claim. Recording it is what arms the throttle; otherwise every
        // login retries and shows the same error again.
        try {
            weeklyHoursRecordFailure($pdo, $state['target_week'], $state['week_end'], $e->getMessage());
        } catch (Exception $inner) {
            // The runs table itself is what failed; nothing to record into.
        }
    }
    if ($lockAcquired) {
        try {
            autoSyncReleaseLock($pdo);
        } catch (Exception $inner) {
            // Connection teardown releases it anyway.
        }
    }
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
