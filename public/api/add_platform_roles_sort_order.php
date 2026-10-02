<?php
/**
 * Migration Script: Add platform_roles.sort_order
 *
 * Gives Configuration > User > Roles & Access a user-defined ordering for the roles
 * list (drag and drop, persisted through manage_login.php's `reorder` action).
 * Existing rows are seeded from `id` so the first render matches the order that was
 * being shown before, when the list came back in primary-key order.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $exists = $pdo->query("SHOW COLUMNS FROM platform_roles LIKE 'sort_order'")->fetch();

    if ($exists) {
        echo json_encode([
            'success' => true,
            'message' => 'platform_roles.sort_order already present.'
        ], JSON_PRETTY_PRINT);
        exit;
    }

    $pdo->exec("ALTER TABLE platform_roles ADD COLUMN sort_order INT NOT NULL DEFAULT 0");
    $pdo->exec("UPDATE platform_roles SET sort_order = id");

    echo json_encode([
        'success' => true,
        'message' => 'platform_roles.sort_order added and seeded from id.'
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
