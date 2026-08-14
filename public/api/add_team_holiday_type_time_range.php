<?php
/**
 * Migration Script: add exclude_from / exclude_to to org_team_holiday_types
 *
 * The Custom holiday type (stored as the enum value `campaign_defined`) carries an optional
 * time range. On that holiday the range is discounted from the team's SCHEDULED hours, so
 * the Run Rate measures against a shorter window; the hours DeskTime tracked are never
 * modified (Employees > Teams > Assign Members > Holidays).
 *
 * Separate from add_team_holiday_types_table.php because that one is CREATE TABLE IF NOT
 * EXISTS and therefore does nothing on a table that already exists.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $added = [];
    foreach (['exclude_from', 'exclude_to'] as $column) {
        $stmt = $pdo->prepare("SHOW COLUMNS FROM org_team_holiday_types LIKE ?");
        $stmt->execute([$column]);
        if (!$stmt->fetch()) {
            $pdo->exec("ALTER TABLE `org_team_holiday_types` ADD COLUMN `$column` time DEFAULT NULL AFTER `holiday_type`");
            $added[] = $column;
        }
    }

    echo json_encode([
        'success' => true,
        'message' => empty($added)
            ? 'org_team_holiday_types already has the time range columns.'
            : 'Added: ' . implode(', ', $added),
        'added' => $added
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
