<?php
/**
 * sync_auto_cli.php
 *
 * Cron entry point for the automatic sync. Unlike the HTTP endpoint, which handles one
 * day per request because a browser is waiting on it, this walks every pending day in a
 * single run -- nobody is waiting, and the whole point of the 6 AM job is to leave nothing
 * for the app to backfill.
 *
 * The lock is taken once for the whole run rather than per day, so a user logging in
 * mid-run gets a clean 'locked' answer instead of interleaving crawls against DeskTime.
 *
 * Usage:  php sync_auto_cli.php            (every pending day)
 *         php sync_auto_cli.php 2026-09-12 (one specific day)
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This script is CLI-only.\n");
}

require_once __DIR__ . '/db_wfm_config.php';
require_once __DIR__ . '/sync_auto_day.php';

// No browser to time out against, and a full backfill is legitimately slow.
set_time_limit(0);

function cliLog($message)
{
    echo '[' . date('Y-m-d H:i:s') . '] ' . $message . PHP_EOL;
}

$lockAcquired = false;

try {
    autoSyncEnsureLogTable($pdo);

    if (!autoSyncAcquireLock($pdo)) {
        cliLog('Another sync is already running; nothing to do.');
        exit(0);
    }
    $lockAcquired = true;

    // Safe now that the lock is held: anything still 'running' is debris.
    autoSyncClearStaleRuns($pdo);

    if (isset($argv[1])) {
        $days = [autoSyncValidateDate($argv[1])];
        $truncated = false;
    } else {
        $gap = autoSyncPendingDays($pdo);
        $days = $gap['pending'];
        $truncated = $gap['truncated'];
        cliLog('Last project date: ' . ($gap['last_project_date'] ?: 'none') . ' | target: up to ' . $gap['yesterday']);
    }

    if (empty($days)) {
        cliLog('Nothing pending.');
        autoSyncReleaseLock($pdo);
        exit(0);
    }

    if ($truncated) {
        cliLog('WARNING: the gap reaches further back than the ' . AUTO_SYNC_MAX_BACKFILL_DAYS . '-day window; older days need Save Hours / Save Projects.');
    }

    cliLog('Pending days: ' . implode(', ', $days));

    $failed = [];
    foreach ($days as $day) {
        // Re-checked per day: the list was built before the first crawl started, and a
        // manual run could have completed one of these in the meantime.
        if (autoSyncIsDayComplete($pdo, $day)) {
            cliLog("{$day}: already complete, skipped.");
            continue;
        }

        $logId = autoSyncClaimDay($pdo, $day);
        try {
            $result = autoSyncRunDay($pdo, $env, $day);
            $status = autoSyncCloseDay($pdo, $logId, $result);
            cliLog("{$day}: {$status} -- {$result['hours']} hours, {$result['projects']} projects"
                . (empty($result['errors']) ? '' : ' | ' . implode(' | ', $result['errors'])));
            if ($status !== 'success') {
                $failed[] = $day;
            }
        } catch (Exception $dayError) {
            // One bad day must not abort the rest of the backfill.
            $stmt = $pdo->prepare("UPDATE desktime_sync_log SET status = 'failure', error_message = ? WHERE id = ?");
            $stmt->execute([substr($dayError->getMessage(), 0, 500), $logId]);
            cliLog("{$day}: FAILED -- " . $dayError->getMessage());
            $failed[] = $day;
        }
    }

    autoSyncReleaseLock($pdo);
    $lockAcquired = false;

    if ($failed) {
        cliLog('Finished with failures on: ' . implode(', ', $failed));
        exit(1);
    }
    cliLog('Finished.');
    exit(0);

} catch (Exception $e) {
    if ($lockAcquired) {
        try {
            autoSyncReleaseLock($pdo);
        } catch (Exception $inner) {
            // Connection teardown releases it anyway.
        }
    }
    cliLog('FATAL: ' . $e->getMessage());
    exit(1);
}
