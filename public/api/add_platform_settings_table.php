<?php
/**
 * Migration Script: Create platform_settings table
 *
 * Generic key/value store for platform-wide preferences managed from
 * Configuration > User. Currently holds `default_user_password`: the password
 * pre-applied to every newly created user and re-applied by the "Reset Password"
 * button in the Edit User modal.
 *
 * NOTE: `default_user_password` is stored in clear text on purpose — the admin UI
 * has to be able to show and re-apply the exact value. It is only ever readable
 * through manage_login.php, which is gated behind the Admin role. User account
 * passwords themselves remain hashed in platform_users.password_hash.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `platform_settings` (
          `setting_key` varchar(64) NOT NULL,
          `setting_value` text DEFAULT NULL,
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`setting_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    echo json_encode([
        'success' => true,
        'message' => 'platform_settings table ready.'
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
