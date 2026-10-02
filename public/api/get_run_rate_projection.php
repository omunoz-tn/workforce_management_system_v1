<?php
/**
 * get_run_rate_projection.php
 * Projected Run Rate for a period that reaches past today (see RunRateProjection.php).
 *
 * GET from, to        the period, Y-m-d
 *     as_of           optional first projected day; defaults to today. A past as_of is a
 *                     backtest: the period is projected as it would have been that day.
 *     team            optional team name
 *     daily=1         also return one row per projected employee-day
 *     compare=1       also return what really happened on the projected days (backtests)
 */
ini_set('display_errors', 0);
error_reporting(0);

header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'RunRateProjection.php';

try {
    session_start();

    $isDate = function ($value) {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) && strtotime($value) !== false;
    };

    $from = $_GET['from'] ?? null;
    $to = $_GET['to'] ?? null;
    if (!$isDate($from) || !$isDate($to) || $from > $to) {
        throw new InvalidArgumentException('Valid from and to dates are required (from <= to).');
    }

    $today = date('Y-m-d');
    $asOf = $_GET['as_of'] ?? $today;
    if (!$isDate($asOf)) {
        throw new InvalidArgumentException('as_of must be a Y-m-d date.');
    }
    // A projection cannot be made from a day that has not come yet.
    $asOf = min($asOf, $today);

    $result = computeRunRateProjection($pdo, $from, $to, [
        'asOf' => $asOf,
        'extraWhere' => team_filter_sql('ota.team_id'),
        'team' => $_GET['team'] ?? null,
        'daily' => !empty($_GET['daily']),
        'compare' => !empty($_GET['compare']),
    ]);

    echo json_encode(['success' => true] + $result);

} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
