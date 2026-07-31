<?php
/**
 * Migration Script: Create org_holiday_type_colors table and seed default colors
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_holiday_type_colors` (
          `holiday_type` enum('non_working','working','campaign_defined') NOT NULL,
          `color` varchar(7) NOT NULL,
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`holiday_type`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    $defaults = [
        'non_working' => '#dc2626',
        'working' => '#16a34a',
        'campaign_defined' => '#eab308'
    ];

    $stmt = $pdo->prepare("INSERT IGNORE INTO org_holiday_type_colors (holiday_type, color) VALUES (?, ?)");
    $seeded = 0;
    foreach ($defaults as $type => $color) {
        $stmt->execute([$type, $color]);
        $seeded += $stmt->rowCount();
    }

    echo json_encode([
        'success' => true,
        'message' => 'org_holiday_type_colors table ready.',
        'seeded_rows' => $seeded
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
