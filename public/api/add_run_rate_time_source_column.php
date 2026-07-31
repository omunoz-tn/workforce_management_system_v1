<?php
/**
 * Migration Script: Add run_rate_time_source column to org_teams
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $check = $pdo->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'org_teams'
        AND COLUMN_NAME = 'run_rate_time_source'");
    $check->execute();
    $exists = (int) $check->fetchColumn() > 0;

    if ($exists) {
        echo json_encode([
            'success' => true,
            'message' => "Column 'run_rate_time_source' already exists on 'org_teams'. No changes made."
        ], JSON_PRETTY_PRINT);
    } else {
        $pdo->exec("ALTER TABLE org_teams
            ADD COLUMN run_rate_time_source ENUM('desktime_time','at_work_time') NOT NULL DEFAULT 'desktime_time'
            AFTER lunch_time");

        echo json_encode([
            'success' => true,
            'message' => "Column 'run_rate_time_source' successfully added to 'org_teams' (default 'desktime_time')."
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
