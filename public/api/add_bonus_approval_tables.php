<?php
/**
 * Migration Script: HR > Bonus approval workflow
 *
 * Creates `org_bonus_periods` — the approval state of each bonus month (BonusApproval.php).
 * The email configuration needs no table of its own: recipients, subject and body are rows
 * in `platform_settings`, absent until HR saves something, which is what makes the default
 * template a fallback rather than a value that has to be seeded.
 *
 * Safe to re-run. CREATE TABLE IF NOT EXISTS is a no-op on an existing table, and this
 * script writes nothing else — every month's state is created by an approval, not here.
 *
 * Running it is optional. Both endpoints call the same ensure guard on every request, for
 * the reason the rest of this module does: a server that never ran the migration must
 * degrade to "no month is approved yet" rather than lose the screen.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'BonusSql.php';
require_once 'BonusApproval.php';

try {
    ensureBonusPeriodTable($pdo);

    $columns = $pdo->query('SHOW COLUMNS FROM org_bonus_periods')->fetchAll(PDO::FETCH_COLUMN);
    $periods = (int) $pdo->query('SELECT COUNT(*) FROM org_bonus_periods')->fetchColumn();

    echo json_encode([
        'success' => true,
        'message' => 'org_bonus_periods is ready.',
        'columns' => $columns,
        'approved_periods' => $periods
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
