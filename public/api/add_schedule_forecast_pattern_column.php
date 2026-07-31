<?php
/**
 * Migration Script: Add pattern column to org_schedule_forecast_overrides
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $check = $pdo->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'org_schedule_forecast_overrides'
        AND COLUMN_NAME = 'pattern'");
    $check->execute();
    $exists = (int) $check->fetchColumn() > 0;

    if ($exists) {
        echo json_encode([
            'success' => true,
            'message' => "Column 'pattern' already exists on 'org_schedule_forecast_overrides'. No changes made."
        ], JSON_PRETTY_PRINT);
    } else {
        $pdo->exec("ALTER TABLE org_schedule_forecast_overrides
            ADD COLUMN pattern TEXT DEFAULT NULL
            AFTER target_end_week_start");

        echo json_encode([
            'success' => true,
            'message' => "Column 'pattern' successfully added to 'org_schedule_forecast_overrides'."
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
