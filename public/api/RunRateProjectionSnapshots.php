<?php
/**
 * RunRateProjectionSnapshots.php
 * A weekly record of what the projected Run Rate said, so it can later be held against
 * what the month actually closed at.
 *
 * Every Tuesday the current calendar month is projected (RunRateProjection.php) and one
 * row per team — plus an '__ALL__' row for the whole organization — is stored. Re-running
 * on the same day replaces that day's rows, so a retried cron is harmless.
 *
 * Hours are stored already netted of lunch ("adjusted"), the figure the Run Rate divides
 * by, and excluded employees are left out, exactly as the report leaves them out.
 */

require_once __DIR__ . '/RunRateProjection.php';

/** Team name of the organization-wide row. */
const RR_SNAPSHOT_ALL_TEAMS = '__ALL__';

function ensureRunRateProjectionSnapshotsTable(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_run_rate_projection_snapshots` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          `snapshot_date` date NOT NULL,
          `period_from` date NOT NULL,
          `period_to` date NOT NULL,
          `team_name` varchar(255) NOT NULL,
          `employees` int(11) NOT NULL DEFAULT 0,
          `actual_to_date` decimal(10,2) NOT NULL DEFAULT 0,
          `scheduled_to_date` decimal(10,2) NOT NULL DEFAULT 0,
          `projected_actual` decimal(10,2) NOT NULL DEFAULT 0,
          `projected_scheduled` decimal(10,2) NOT NULL DEFAULT 0,
          `projected_pct` decimal(6,2) DEFAULT NULL,
          `high_confidence_share` decimal(5,2) DEFAULT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          PRIMARY KEY (`id`),
          UNIQUE KEY `uniq_snapshot_team` (`snapshot_date`, `period_from`, `period_to`, `team_name`),
          KEY `idx_period` (`period_from`, `period_to`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");
}

/**
 * Projects the calendar month of `$snapshotDate` as of that day and stores it.
 *
 * @return array<int,array> the rows written
 */
function saveRunRateProjectionSnapshot(PDO $pdo, string $snapshotDate): array
{
    ensureRunRateProjectionSnapshotsTable($pdo);

    $periodFrom = date('Y-m-01', strtotime($snapshotDate));
    $periodTo = date('Y-m-t', strtotime($snapshotDate));

    // No RBAC fragment: the snapshot is the organization's record, filtered by team when
    // it is read back (get_run_rate_projection_snapshots.php).
    $projection = computeRunRateProjection($pdo, $periodFrom, $periodTo, ['asOf' => $snapshotDate]);

    $teams = [];
    foreach ($projection['data'] as $row) {
        if ((int) $row['is_excluded']) {
            continue;
        }
        foreach ([$row['team_name'], RR_SNAPSHOT_ALL_TEAMS] as $team) {
            $t = $teams[$team] ?? [
                'employees' => [], 'actual_to_date' => 0.0, 'scheduled_to_date' => 0.0,
                'projected_actual' => 0.0, 'projected_scheduled' => 0.0, 'high_scheduled' => 0.0,
            ];
            $projectedAdjusted = max(0.0, $row['projected_scheduled'] - $row['projected_lunch']);
            $t['employees'][$row['employee_id']] = true;
            $t['actual_to_date'] += $row['actual_to_date'];
            $t['scheduled_to_date'] += $row['scheduled_to_date'] - $row['lunch_to_date'];
            $t['projected_actual'] += $row['projected_actual'];
            $t['projected_scheduled'] += $projectedAdjusted;
            $t['high_scheduled'] += $row['confidence'] === 'high' ? $projectedAdjusted : 0.0;
            $teams[$team] = $t;
        }
    }

    $pdo->prepare("DELETE FROM org_run_rate_projection_snapshots WHERE snapshot_date = ? AND period_from = ? AND period_to = ?")
        ->execute([$snapshotDate, $periodFrom, $periodTo]);

    $insert = $pdo->prepare("
        INSERT INTO org_run_rate_projection_snapshots
            (snapshot_date, period_from, period_to, team_name, employees, actual_to_date, scheduled_to_date,
             projected_actual, projected_scheduled, projected_pct, high_confidence_share)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");

    $written = [];
    foreach ($teams as $team => $t) {
        $totalActual = $t['actual_to_date'] + $t['projected_actual'];
        $totalScheduled = max(0.0, $t['scheduled_to_date']) + $t['projected_scheduled'];
        $row = [
            $snapshotDate, $periodFrom, $periodTo, $team, count($t['employees']),
            round($t['actual_to_date'], 2), round($t['scheduled_to_date'], 2),
            round($t['projected_actual'], 2), round($t['projected_scheduled'], 2),
            $totalScheduled > 0 ? round($totalActual / $totalScheduled * 100, 2) : null,
            $t['projected_scheduled'] > 0 ? round($t['high_scheduled'] / $t['projected_scheduled'] * 100, 2) : null,
        ];
        $insert->execute($row);
        $written[] = array_combine(
            ['snapshot_date', 'period_from', 'period_to', 'team_name', 'employees', 'actual_to_date', 'scheduled_to_date',
             'projected_actual', 'projected_scheduled', 'projected_pct', 'high_confidence_share'],
            $row
        );
    }
    return $written;
}
