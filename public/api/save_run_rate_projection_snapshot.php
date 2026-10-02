<?php
/**
 * save_run_rate_projection_snapshot.php
 *
 * Cron entry point for the weekly projected Run Rate snapshot (see
 * RunRateProjectionSnapshots.php). Scheduled for Tuesdays in docker/sync-cron.
 *
 * Usage:  php save_run_rate_projection_snapshot.php             (today, Tuesdays only)
 *         php save_run_rate_projection_snapshot.php 2026-10-06  (that day, any weekday)
 *
 * The Tuesday check is here as well as in the cron line so an extra crontab entry or a
 * manual run on the wrong day cannot add a mid-week point to the series. Naming a date
 * skips it on purpose — that is how a missed Tuesday is filled in by hand.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This script is CLI-only.\n");
}

require_once __DIR__ . '/db_wfm_config.php';
require_once __DIR__ . '/RunRateProjectionSnapshots.php';

set_time_limit(0);

$date = $argv[1] ?? date('Y-m-d');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || strtotime($date) === false) {
    fwrite(STDERR, "Invalid date: $date\n");
    exit(1);
}
if (!isset($argv[1]) && (int) date('N', strtotime($date)) !== 2) {
    echo '[' . date('Y-m-d H:i:s') . "] $date is not a Tuesday; no snapshot taken." . PHP_EOL;
    exit(0);
}

try {
    $rows = saveRunRateProjectionSnapshot($pdo, $date);
    $all = array_values(array_filter($rows, function ($r) {
        return $r['team_name'] === RR_SNAPSHOT_ALL_TEAMS;
    }))[0] ?? null;
    echo '[' . date('Y-m-d H:i:s') . "] Snapshot $date saved: " . (count($rows) - ($all ? 1 : 0)) . ' teams'
        . ($all && $all['projected_pct'] !== null ? ", organization projected at {$all['projected_pct']}%" : '')
        . '.' . PHP_EOL;
} catch (Exception $e) {
    fwrite(STDERR, '[' . date('Y-m-d H:i:s') . '] Snapshot failed: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
