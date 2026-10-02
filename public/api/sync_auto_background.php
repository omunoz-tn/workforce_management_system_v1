<?php
/**
 * sync_auto_background.php
 * Automated background sync for Core Hours and Projects.
 *
 * Processes exactly ONE day per request -- ?date=YYYY-MM-DD, defaulting to yesterday.
 * One day per request is deliberate: the project step costs one DeskTime call per
 * employee, so a multi-day backfill inside a single request would blow set_time_limit and
 * leave the work half done with nothing recorded. The app asks sync_status.php which days
 * are pending and calls this once per day, so every day either completes and is logged,
 * or is retried cleanly on the next pass. The unattended equivalent is sync_auto_cli.php.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'sync_auto_day.php';

// The app calls this from the browser on every login, so it can no longer be an open
// endpoint. The cron runner goes through the PHP CLI, where there is no session at all.
if (PHP_SAPI !== 'cli') {
    session_start();
    if (!isset($_SESSION['user_id'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Not authenticated']);
        exit;
    }
}

// A single day genuinely costs about five minutes (one DeskTime call per employee), so
// the old 300s ceiling was landing right on top of the real runtime: the first live run
// was killed at 299s, after writing the data but before closing its log row. On Linux
// max_execution_time ignores time spent inside curl, so this only bites on Windows -- which
// is exactly where the dev server runs, and a limit that behaves differently per platform
// is not a limit worth keeping tight.
set_time_limit(1800);

// The day must be finished and logged even if the user closes the tab; a half-written day
// whose row never closes is the one state this design cannot recover from cheaply.
ignore_user_abort(true);

$lockAcquired = false;
$logId = null;

try {
    autoSyncEnsureLogTable($pdo);

    $targetDate = autoSyncValidateDate($_GET['date'] ?? date('Y-m-d', strtotime('-1 day')));

    if (autoSyncIsDayComplete($pdo, $targetDate)) {
        echo json_encode([
            'success' => true,
            'status' => 'skipped',
            'message' => 'This day was already synced automatically.',
            'date' => $targetDate
        ]);
        exit;
    }

    if (!autoSyncAcquireLock($pdo)) {
        echo json_encode([
            'success' => true,
            'status' => 'locked',
            'message' => 'Another sync is already running.',
            'date' => $targetDate
        ]);
        exit;
    }
    $lockAcquired = true;

    autoSyncClearStaleRuns($pdo);
    $logId = autoSyncClaimDay($pdo, $targetDate);

    $result = autoSyncRunDay($pdo, $env, $targetDate);
    $status = autoSyncCloseDay($pdo, $logId, $result);
    $logId = null; // closed out; the catch below must not overwrite it

    autoSyncReleaseLock($pdo);
    $lockAcquired = false;

    echo json_encode([
        'success' => true,
        'status' => $status === 'success' ? 'completed' : 'failed',
        'date' => $targetDate,
        'hours_synced' => $result['hours'],
        'projects_synced' => $result['projects'],
        'errors' => $result['errors'],
        'row_errors' => $result['row_errors']
    ]);

} catch (Exception $e) {
    // A caught error must not leave the claimed row sitting at 'running'.
    if ($logId) {
        try {
            $stmt = $pdo->prepare("UPDATE desktime_sync_log SET status = 'failure', error_message = ? WHERE id = ?");
            $stmt->execute([substr($e->getMessage(), 0, 500), $logId]);
        } catch (Exception $inner) {
            // Reporting the original failure matters more than recording it.
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
