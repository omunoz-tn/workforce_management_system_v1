<?php
/**
 * sync_status.php
 *
 * Read-only companion to sync_auto_background.php: reports which days still need the
 * automatic sync, without touching DeskTime. The app calls this on every login, so it has
 * to stay cheap -- two indexed queries and no outbound HTTP. The expensive crawl only ever
 * runs for the days this endpoint hands back.
 *
 * The gap rules themselves live in sync_auto_day.php, so this endpoint and the cron runner
 * can never disagree about what "pending" means.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'sync_auto_day.php';
require_once 'sync_weekly_window.php';
session_start();

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Not authenticated']);
    exit;
}

try {
    $gap = autoSyncPendingDays($pdo);

    echo json_encode([
        'success' => true,
        'pending_days' => $gap['pending'],
        'last_project_date' => $gap['last_project_date'],
        'yesterday' => $gap['yesterday'],
        'backfill_limit' => AUTO_SYNC_MAX_BACKFILL_DAYS,
        'truncated' => $gap['truncated'],
        // The weekly Save Hours job rides along on this same call rather than adding a
        // second round trip on every login. It answers a different question from
        // pending_days -- which week of hours is owed, not which days of projects are
        // missing -- and stays just as cheap: one indexed lookup, no DeskTime traffic.
        'weekly_hours' => weeklyHoursState($pdo)
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
