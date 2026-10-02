<?php
/**
 * get_run_rate_projection_snapshots.php
 * The Tuesday snapshots of one month's projected Run Rate, next to the Run Rate that month
 * really reached — to date while the month is open, final once it has closed.
 *
 * GET month   Y-m
 */
ini_set('display_errors', 0);
error_reporting(0);

header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'RunRateProjectionSnapshots.php';

try {
    session_start();

    $month = $_GET['month'] ?? date('Y-m');
    if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
        throw new InvalidArgumentException('month must be Y-m.');
    }
    $periodFrom = $month . '-01';
    $periodTo = date('Y-m-t', strtotime($periodFrom));

    ensureRunRateProjectionSnapshotsTable($pdo);

    $stmt = $pdo->prepare("
        SELECT snapshot_date, team_name, employees, actual_to_date, scheduled_to_date,
               projected_actual, projected_scheduled, projected_pct, high_confidence_share
        FROM org_run_rate_projection_snapshots
        WHERE period_from = ? AND period_to = ?
        ORDER BY snapshot_date ASC, team_name ASC
    ");
    $stmt->execute([$periodFrom, $periodTo]);
    $snapshots = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Snapshots are stored for the whole organization; a role scoped to some teams sees
    // those teams only, and not the organization-wide row that would include the rest.
    $allowedNames = null;
    if (is_team_restricted()) {
        $ids = current_allowed_teams();
        $allowedNames = [];
        if ($ids) {
            $allowedNames = $pdo->query("SELECT name FROM org_teams WHERE id IN (" . implode(',', $ids) . ")")
                ->fetchAll(PDO::FETCH_COLUMN);
        }
        $snapshots = array_values(array_filter($snapshots, function ($s) use ($allowedNames) {
            return in_array($s['team_name'], $allowedNames, true);
        }));
    }

    // What the month really did, through yesterday at most.
    $realTo = min($periodTo, date('Y-m-d', strtotime('-1 day')));
    $real = [];
    if ($periodFrom <= $realTo) {
        $totals = $pdo->prepare(rrEmployeeTotalsSql(team_filter_sql('ota.team_id')));
        $totals->execute(['from' => $periodFrom, 'to' => $realTo]);
        foreach ($totals->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if ((int) $r['is_excluded']) {
                continue;
            }
            $teams = [$r['team_name']];
            if ($allowedNames === null) {
                $teams[] = RR_SNAPSHOT_ALL_TEAMS;
            }
            foreach ($teams as $team) {
                $real[$team] = $real[$team] ?? ['actual' => 0.0, 'scheduled' => 0.0];
                $real[$team]['actual'] += (float) $r['mtd_actual'];
                $real[$team]['scheduled'] += (float) $r['mtd_scheduled'] - (float) $r['lunch_deduction_hours'];
            }
        }
    }
    foreach ($real as $team => &$r) {
        $r['pct'] = $r['scheduled'] > 0 ? round($r['actual'] / $r['scheduled'] * 100, 2) : null;
    }
    unset($r);

    echo json_encode([
        'success' => true,
        'period_from' => $periodFrom,
        'period_to' => $periodTo,
        'real_through' => $periodFrom <= $realTo ? $realTo : null,
        'month_closed' => $realTo >= $periodTo,
        'all_teams_key' => RR_SNAPSHOT_ALL_TEAMS,
        'snapshots' => $snapshots,
        'real' => (object) $real,
    ]);

} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
