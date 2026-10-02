<?php
/**
 * sync_weekly_window.php
 *
 * The rules of the weekly Save Hours job, shared by the endpoint that performs it
 * (sync_weekly_hours.php) and the read-only check the app makes on every login
 * (sync_status.php). Both have to agree on "is it due?" and "which week?", or the app
 * would keep asking for a week the backend keeps refusing -- the same reason
 * sync_backfill_window.php exists for the daily job.
 *
 * The job: sync the previous Monday-Sunday week of Core Hours, hours only, no project
 * data. Tuesday is the intended day; Wednesday through Friday are catch-up days for that
 * same week, because nothing guarantees anyone opens the app on a Tuesday. Saturday,
 * Sunday and Monday do not trigger it at all.
 *
 * Tue/Wed/Thu/Fri of one calendar week all resolve to the same target week, so the
 * catch-up window needs no state of its own -- the date arithmetic gives it for free.
 *
 * The queue holds exactly ONE week. A week nobody caught during its Tue-Fri window is not
 * carried forward: the next Tuesday targets the new previous week, and the stale one is
 * dropped (marked 'superseded' if it had ever been attempted). Recovering a dropped week
 * is Save Hours' job, manually, which is what its 12-week preset list is for.
 *
 * All dates come from date()/strtotime(), which db_wfm_config.php pins to
 * America/Santo_Domingo. The container clock is UTC, so deciding "is it Tuesday?" from
 * anywhere else -- the browser included -- would disagree with this by up to four hours.
 */
require_once __DIR__ . '/sync_backfill_window.php'; // syncTableExists()

/**
 * How long to leave a failed or abandoned week alone before trying it again.
 *
 * Without this, a week that fails for a permanent reason (a revoked API key, a range
 * DeskTime no longer serves) would be retried by every user who logs in -- and bursts
 * against DeskTime are exactly what trips its rate limit, which comes back looking
 * identical to an auth failure. One retry per hour still catches a transient outage well
 * inside the Tue-Fri window.
 */
if (!defined('WEEKLY_HOURS_RETRY_MINUTES')) {
    define('WEEKLY_HOURS_RETRY_MINUTES', 60);
}

/** Days of the week (date('N'): 1=Mon .. 7=Sun) on which the job may run. */
if (!defined('WEEKLY_HOURS_TRIGGER_DAYS')) {
    define('WEEKLY_HOURS_TRIGGER_DAYS', '2,3,4,5'); // Tue, Wed, Thu, Fri
}

/**
 * 'skipped' is a week someone already covered by hand with Save Hours and told the job to
 * leave alone. It counts as done exactly like 'success' -- the only difference is that the
 * row says the job itself never ran it.
 */
function weeklyHoursEnsureRunsTable(PDO $pdo)
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS weekly_hours_runs (
        week_start DATE NOT NULL,
        week_end DATE NOT NULL,
        status ENUM('running', 'success', 'failure', 'superseded', 'skipped') NOT NULL,
        days_ok TINYINT NOT NULL DEFAULT 0,
        attempts INT NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMP NULL DEFAULT NULL,
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (week_start)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
}

/**
 * Lets desktime_sync_log hold the weekly job's per-day rows.
 *
 * Deliberately here and not in autoSyncEnsureLogTable(): that runs at the top of the daily
 * sync too, and a migration only the weekly job needs must not be able to take the daily
 * one down if it fails. That is not hypothetical -- it is exactly what happened the first
 * time, see syncEnumEnsureValue().
 */
function weeklyHoursEnsureLogType(PDO $pdo)
{
    syncEnumEnsureValue($pdo, 'desktime_sync_log', 'sync_type', 'weekly');
}

/**
 * Monday of the week containing $date.
 *
 * Done by hand rather than with strtotime('monday this week'), whose answer on a Sunday
 * has changed between PHP versions -- and Sunday is precisely the boundary this job is
 * built around.
 */
function weeklyHoursMondayOf($date)
{
    $ts = strtotime($date);
    $dow = (int) date('N', $ts); // 1 = Monday .. 7 = Sunday
    return date('Y-m-d', strtotime('-' . ($dow - 1) . ' days', $ts));
}

/** True on Tue/Wed/Thu/Fri; the job does not exist on any other day. */
function weeklyHoursIsTriggerDay($today)
{
    $days = array_map('intval', explode(',', WEEKLY_HOURS_TRIGGER_DAYS));
    return in_array((int) date('N', strtotime($today)), $days, true);
}

/**
 * The one week the job may target today, or null when today is not a trigger day.
 * Returns ['start' => Monday, 'end' => Sunday].
 */
function weeklyHoursTargetWeek($today)
{
    if (!weeklyHoursIsTriggerDay($today)) {
        return null;
    }
    $start = date('Y-m-d', strtotime(weeklyHoursMondayOf($today) . ' -7 days'));
    return [
        'start' => $start,
        'end' => date('Y-m-d', strtotime($start . ' +6 days'))
    ];
}

/** The recorded run for a week, or null. Safe to call before the table exists. */
function weeklyHoursFindRun(PDO $pdo, $weekStart)
{
    if (!syncTableExists($pdo, 'weekly_hours_runs')) {
        return null;
    }
    $stmt = $pdo->prepare("SELECT week_start, week_end, status, days_ok, attempts,
                                  last_attempt_at, error_message
                           FROM weekly_hours_runs WHERE week_start = ?");
    $stmt->execute([$weekStart]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

/**
 * The whole answer to "should the weekly hours job run right now, and for which week?".
 *
 * Read-only and cheap -- one indexed lookup, no DeskTime traffic, no table creation -- so
 * sync_status.php can call it on every single login. 'reason' is what the caller shows
 * when 'due' is false, and exists so a week that is merely throttled cannot be mistaken
 * for one that is finished.
 */
function weeklyHoursState(PDO $pdo, $today = null)
{
    $today = $today ?: date('Y-m-d');
    $target = weeklyHoursTargetWeek($today);

    if (!$target) {
        return [
            'due' => false,
            'reason' => 'off_day',
            'target_week' => null,
            'week_end' => null,
            'last_status' => null,
            'attempts' => 0
        ];
    }

    $run = weeklyHoursFindRun($pdo, $target['start']);
    $base = [
        'due' => true,
        'reason' => 'pending',
        'target_week' => $target['start'],
        'week_end' => $target['end'],
        'last_status' => $run['status'] ?? null,
        'attempts' => (int) ($run['attempts'] ?? 0)
    ];

    if (!$run) {
        return $base;
    }

    if (in_array($run['status'], ['success', 'skipped'], true)) {
        return array_merge($base, ['due' => false, 'reason' => 'already_done']);
    }

    // 'superseded' can only ever belong to an older week, never to the current target, so
    // anything left here is a failure or a run that never closed. Both wait out the
    // throttle before being tried again.
    if (!empty($run['last_attempt_at'])) {
        $retryAfter = strtotime($run['last_attempt_at'] . ' +' . WEEKLY_HOURS_RETRY_MINUTES . ' minutes');
        if ($retryAfter > time()) {
            return array_merge($base, [
                'due' => false,
                'reason' => 'throttled',
                'next_retry_at' => date('Y-m-d H:i:s', $retryAfter)
            ]);
        }
    }

    return array_merge($base, ['reason' => 'retry']);
}

/**
 * Holding the lock means nothing else can legitimately be mid-run, so a row still marked
 * 'running' is debris from a request that died. Closing it as a failure is what lets the
 * week be retried instead of sitting there looking busy forever.
 */
function weeklyHoursClearStaleRuns(PDO $pdo)
{
    $pdo->exec("UPDATE weekly_hours_runs
                SET status = 'failure',
                    error_message = CONCAT(COALESCE(error_message, ''), ' | Interrumpido (timeout o navegador cerrado)')
                WHERE status = 'running'");
}

/**
 * Drops every unfinished week older than the one being targeted now.
 *
 * This is the "queue of one" rule made explicit: a week that went past its Tue-Fri window
 * is never picked up again, and marking it rather than deleting it is what lets an admin
 * see in the table that it was dropped and needs a manual Save Hours. Weeks that were
 * never attempted leave no row at all -- nothing was ever started for them to record.
 *
 * Returns the week_start values it dropped, so the caller can say so in the UI.
 */
function weeklyHoursSupersedeOlder(PDO $pdo, $weekStart)
{
    $stmt = $pdo->prepare("SELECT week_start FROM weekly_hours_runs
                           WHERE week_start < ? AND status NOT IN ('success', 'skipped', 'superseded')");
    $stmt->execute([$weekStart]);
    $dropped = $stmt->fetchAll(PDO::FETCH_COLUMN);

    if ($dropped) {
        $stmt = $pdo->prepare("UPDATE weekly_hours_runs
                               SET status = 'superseded',
                                   error_message = CONCAT(COALESCE(error_message, ''),
                                       ' | Descartada: solo se retiene la semana anterior (usar Save Hours para recuperarla)')
                               WHERE week_start < ? AND status NOT IN ('success', 'skipped', 'superseded')");
        $stmt->execute([$weekStart]);
    }

    return $dropped;
}

/**
 * Records the attempt before any DeskTime call happens, so a crash leaves evidence.
 *
 * The shutdown guard is the same defence sync_auto_day.php needed after a real run was
 * killed by max_execution_time and left its row at 'running' forever. Shutdown functions
 * still run after a timeout or a fatal; the UPDATE is conditional on the row still being
 * 'running', which makes it a no-op on the normal path.
 */
function weeklyHoursClaim(PDO $pdo, $weekStart, $weekEnd)
{
    // PHP's clock, not the database's NOW(). weeklyHoursState() compares this column
    // against time(), and the two clocks are not the same one: PHP is pinned to
    // America/Santo_Domingo by db_wfm_config.php while the MySQL server answers NOW() in
    // its own session timezone, which is UTC on the containers here. Mixing them made a
    // just-written row look four hours old in the future, so a failed week stayed
    // throttled for five hours instead of one. Whoever compares the value has to be the
    // one who wrote it.
    $now = date('Y-m-d H:i:s');

    $stmt = $pdo->prepare("INSERT INTO weekly_hours_runs
            (week_start, week_end, status, days_ok, attempts, last_attempt_at, error_message)
        VALUES (?, ?, 'running', 0, 1, ?, '')
        ON DUPLICATE KEY UPDATE
            week_end = VALUES(week_end),
            status = 'running',
            days_ok = 0,
            attempts = attempts + 1,
            last_attempt_at = VALUES(last_attempt_at),
            error_message = ''");
    $stmt->execute([$weekStart, $weekEnd, $now]);

    register_shutdown_function(function () use ($pdo, $weekStart) {
        try {
            $error = error_get_last();
            $reason = ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true))
                ? substr($error['message'], 0, 300)
                : 'El proceso termino sin cerrar la semana (timeout, fatal o conexion abortada)';

            $stmt = $pdo->prepare("UPDATE weekly_hours_runs
                                   SET status = 'failure', error_message = ?
                                   WHERE week_start = ? AND status = 'running'");
            $stmt->execute(["{$weekStart}: {$reason}", $weekStart]);
        } catch (Exception $e) {
            // Nothing useful left to do this late in the request.
        }
    });
}

/**
 * Closes a claimed week. Only a week whose seven days all came back clean counts as a
 * success; anything less stays retryable, because the next run re-syncs the whole week
 * anyway and a half-week marked done would never be corrected.
 */
function weeklyHoursClose(PDO $pdo, $weekStart, $daysOk, array $messages)
{
    $status = ($daysOk === 7 && empty($messages)) ? 'success' : 'failure';

    $stmt = $pdo->prepare("UPDATE weekly_hours_runs
                           SET status = ?, days_ok = ?, error_message = ?
                           WHERE week_start = ?");
    $stmt->execute([$status, $daysOk, substr(implode(' | ', $messages), 0, 2000), $weekStart]);

    return $status;
}

/**
 * Records a failure that happened before the week was claimed -- a migration, the lock
 * query, anything ahead of weeklyHoursClaim().
 *
 * Without a row the throttle has nothing to measure from, so the week stays 'pending' and
 * every login retries it and puts the same error toast back on screen. That is how the
 * first production failure behaved. A week already finished is never downgraded here.
 */
function weeklyHoursRecordFailure(PDO $pdo, $weekStart, $weekEnd, $message)
{
    // PHP's clock, for the same reason as in weeklyHoursClaim().
    $stmt = $pdo->prepare("INSERT INTO weekly_hours_runs
            (week_start, week_end, status, days_ok, attempts, last_attempt_at, error_message)
        VALUES (?, ?, 'failure', 0, 1, ?, ?)
        ON DUPLICATE KEY UPDATE
            status = IF(status IN ('success', 'skipped'), status, 'failure'),
            attempts = attempts + 1,
            last_attempt_at = VALUES(last_attempt_at),
            error_message = IF(status IN ('success', 'skipped'), error_message, VALUES(error_message))");
    $stmt->execute([$weekStart, $weekEnd, date('Y-m-d H:i:s'), substr($message, 0, 2000)]);
}
