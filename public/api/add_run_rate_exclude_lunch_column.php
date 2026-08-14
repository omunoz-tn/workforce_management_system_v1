<?php
/**
 * Migration Script: Add exclude_lunch_from_run_rate column to org_teams
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $check = $pdo->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'org_teams'
        AND COLUMN_NAME = 'exclude_lunch_from_run_rate'");
    $check->execute();
    $exists = (int) $check->fetchColumn() > 0;

    if ($exists) {
        echo json_encode([
            'success' => true,
            'message' => "Column 'exclude_lunch_from_run_rate' already exists on 'org_teams'. No changes made."
        ], JSON_PRETTY_PRINT);
    } else {
        $pdo->exec("ALTER TABLE org_teams
            ADD COLUMN exclude_lunch_from_run_rate TINYINT(1) NOT NULL DEFAULT 0
            AFTER run_rate_time_source");

        echo json_encode([
            'success' => true,
            'message' => "Column 'exclude_lunch_from_run_rate' successfully added to 'org_teams' (default 0 / off)."
        ], JSON_PRETTY_PRINT);
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
