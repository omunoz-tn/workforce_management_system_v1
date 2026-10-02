<?php
/**
 * Migration Script: Create org_run_rate_projection_snapshots table
 * (the Tuesday snapshots of the projected Run Rate, see RunRateProjectionSnapshots.php).
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'RunRateProjectionSnapshots.php';

try {
    ensureRunRateProjectionSnapshotsTable($pdo);

    echo json_encode([
        'success' => true,
        'message' => 'org_run_rate_projection_snapshots table ready.'
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
