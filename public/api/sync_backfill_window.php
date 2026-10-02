<?php
/**
 * sync_backfill_window.php
 *
 * Shared between sync_status.php (which decides what is pending) and
 * sync_auto_background.php (which refuses anything outside the window). Both have to
 * agree on the limit, or the app would keep asking for a day the backend keeps rejecting.
 */

/**
 * How many days back the automatic sync is allowed to reach, counting yesterday itself.
 * The project step costs one DeskTime request per employee per day, so this is the cap
 * that keeps a long-neglected table from turning a login into an hours-long crawl.
 */
if (!defined('AUTO_SYNC_MAX_BACKFILL_DAYS')) {
    define('AUTO_SYNC_MAX_BACKFILL_DAYS', 7);
}

/**
 * These tables are created by migrations/other endpoints rather than here, and the sync
 * log in particular does not exist until the first automatic run. Probing beats letting
 * a missing table surface as a 500 on a plain status check.
 */
function syncTableExists(PDO $pdo, $name)
{
    $stmt = $pdo->prepare("SHOW TABLES LIKE ?");
    $stmt->execute([$name]);
    return (bool) $stmt->fetch();
}

/**
 * Adds one value to an ENUM column, keeping every value already there.
 *
 * Migrations here used to MODIFY the column with the whole list restated, which quietly
 * assumes this code is the only thing that ever widened it. It is not: the production
 * desktime_sync_log.sync_type also carries 'recovery' (223 rows written by a one-off script
 * on 2026-08-11, not in this repo), so restating ('manual','automatic','weekly') meant
 * dropping it. MariaDB in strict mode refused with "1265 Data truncated for column
 * 'sync_type'", and because that migration ran at the top of every sync it took the daily
 * job down along with the weekly one. Outside strict mode the same statement would have
 * blanked those 223 rows instead of failing.
 *
 * So the live definition is read and appended to, with nullability and default carried
 * over. Returns true when the column was altered, false when the value was already there.
 * $table and $column come from code, never from a request.
 */
function syncEnumEnsureValue(PDO $pdo, $table, $column, $value)
{
    $col = $pdo->query("SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column))->fetch(PDO::FETCH_ASSOC);
    if (!$col) {
        throw new Exception("Column {$table}.{$column} does not exist");
    }
    if (stripos($col['Type'], 'enum(') !== 0) {
        throw new Exception("Column {$table}.{$column} is {$col['Type']}, not an ENUM");
    }

    preg_match_all("/'((?:[^']|'')*)'/", $col['Type'], $m);
    $values = array_map(fn($v) => str_replace("''", "'", $v), $m[1]);
    if (in_array($value, $values, true)) {
        return false;
    }
    $values[] = $value;

    $list = implode(', ', array_map([$pdo, 'quote'], $values));
    $nullable = strtoupper($col['Null']) === 'YES';

    $default = '';
    if ($col['Default'] !== null) {
        // MySQL reports the bare value; some MariaDB versions report it quoted.
        $raw = preg_match("/^'(.*)'$/s", $col['Default'], $q) ? str_replace("''", "'", $q[1]) : $col['Default'];
        $default = ' DEFAULT ' . $pdo->quote($raw);
    } elseif ($nullable) {
        $default = ' DEFAULT NULL';
    }

    $pdo->exec("ALTER TABLE `$table` MODIFY COLUMN `$column` ENUM($list) "
        . ($nullable ? 'NULL' : 'NOT NULL') . $default);
    return true;
}

/** First day the automatic sync may touch, given "yesterday" as the last. */
function autoSyncEarliestDate($yesterday)
{
    return date('Y-m-d', strtotime($yesterday . ' -' . (AUTO_SYNC_MAX_BACKFILL_DAYS - 1) . ' days'));
}
