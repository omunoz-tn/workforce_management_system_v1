<?php
/**
 * Migration Script: Create org_holiday_country_colors table and seed default colors
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_holiday_country_colors` (
          `country_code` varchar(2) NOT NULL,
          `color` varchar(7) NOT NULL,
          `text_color` varchar(7) NOT NULL,
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`country_code`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    $defaults = [
        'DO' => ['#2563eb', '#ffffff'],
        'US' => ['#7c3aed', '#ffffff']
    ];

    $stmt = $pdo->prepare("INSERT IGNORE INTO org_holiday_country_colors (country_code, color, text_color) VALUES (?, ?, ?)");
    $seeded = 0;
    foreach ($defaults as $code => [$color, $textColor]) {
        $stmt->execute([$code, $color, $textColor]);
        $seeded += $stmt->rowCount();
    }

    echo json_encode([
        'success' => true,
        'message' => 'org_holiday_country_colors table ready.',
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
