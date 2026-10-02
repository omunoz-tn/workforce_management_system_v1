<?php
/**
 * Migration Script: Add source_week_start to org_shift_schedule_patterns
 *
 * The week the seven cards were read from when the schedule was built — the "Source week"
 * named by the picker in Scheduling > Shift Management. It was never stored, so it is
 * NULL-able and rows saved before this migration keep NULL: the value cannot be inferred
 * after the fact, and Schedule History says "Not recorded" for them rather than guessing.
 *
 * Unrelated to org_schedule_forecast_overrides.source_week_start, which belongs to the
 * Forecast feature and carries its own meaning.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $check = $pdo->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'org_shift_schedule_patterns'
        AND COLUMN_NAME = 'source_week_start'");
    $check->execute();
    $exists = (int) $check->fetchColumn() > 0;

    if ($exists) {
        echo json_encode([
            'success' => true,
            'message' => "Column 'source_week_start' already exists on 'org_shift_schedule_patterns'. No changes made."
        ], JSON_PRETTY_PRINT);
    } else {
        $pdo->exec("ALTER TABLE org_shift_schedule_patterns
            ADD COLUMN source_week_start DATE DEFAULT NULL
            AFTER pattern");

        $legacy = (int) $pdo->query(
            "SELECT COUNT(*) FROM org_shift_schedule_patterns WHERE source_week_start IS NULL"
        )->fetchColumn();

        echo json_encode([
            'success' => true,
            'message' => "Column 'source_week_start' successfully added to 'org_shift_schedule_patterns'.",
            'rows_without_source_week' => $legacy,
            'note' => 'Existing rows keep NULL on purpose — the source week they were built from was never recorded.'
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
