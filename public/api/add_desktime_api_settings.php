<?php
/**
 * Migration Script: Configuration > Desktime API
 *
 *   1. Grants the `settings-desktime-api` sub-menu to the Admin role (a new menu_item_id is
 *      invisible to everyone until granted; other roles are assigned by hand from
 *      Configuration > User > Roles).
 *   2. Copies the .env's DESKTIME_API_KEY_* lines into platform_settings, if nothing is saved
 *      yet, so from here on FOCUS reads the keys from the configuration. Idempotent: an
 *      existing saved value is never overwritten.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $stmt = $pdo->prepare("SELECT id FROM platform_roles WHERE name = 'Admin'");
    $stmt->execute();
    $adminRoleId = $stmt->fetchColumn();
    if (!$adminRoleId) {
        throw new Exception("Role 'Admin' not found. Please verify the database initialization.");
    }

    $permission = 'settings-desktime-api';
    $stmtInsert = $pdo->prepare("INSERT IGNORE INTO platform_permissions (role_id, menu_item_id) VALUES (?, ?)");
    $stmtInsert->execute([$adminRoleId, $permission]);
    $granted = $stmtInsert->rowCount();

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `platform_settings` (
          `setting_key` varchar(64) NOT NULL,
          `setting_value` text DEFAULT NULL,
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`setting_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    $envText = desktimeApiKeysToText(array_filter(desktimeAccounts($GLOBALS['DESKTIME_API_KEYS_FROM_ENV'])));
    $seeded = 0;
    if ($envText !== '') {
        $stmtSeed = $pdo->prepare("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES (?, ?)");
        $stmtSeed->execute([DESKTIME_API_KEYS_SETTING, $envText]);
        $seeded = $stmtSeed->rowCount();
    }

    echo json_encode([
        'success' => true,
        'permission' => $granted ? "Permission '{$permission}' assigned to Admin role." : "Permission '{$permission}' was already assigned to Admin role.",
        'keys' => $seeded ? 'DeskTime keys copied from .env into the configuration.' : 'DeskTime keys were already in the configuration (left as they are).'
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()], JSON_PRETTY_PRINT);
}
