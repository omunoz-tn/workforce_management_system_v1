<?php
/**
 * Migration Script: Create org_run_rate_color_ranges table and seed default bands
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_run_rate_color_ranges` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          `range_start` decimal(6,2) NOT NULL,
          `color` varchar(7) NOT NULL,
          `is_blinking` tinyint(1) NOT NULL DEFAULT 0,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`id`),
          UNIQUE KEY `unique_range_start` (`range_start`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    $defaults = [
        [98, '#99C24D', 0],
        [95, '#F4D35E', 0],
        [91, '#D80032', 0],
        [0, '#D80032', 1]
    ];
    $stmt = $pdo->prepare("INSERT IGNORE INTO org_run_rate_color_ranges (range_start, color, is_blinking) VALUES (?, ?, ?)");
    $seeded = 0;
    foreach ($defaults as $row) {
        $stmt->execute($row);
        $seeded += $stmt->rowCount();
    }

    echo json_encode([
        'success' => true,
        'message' => 'org_run_rate_color_ranges table ready.',
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
