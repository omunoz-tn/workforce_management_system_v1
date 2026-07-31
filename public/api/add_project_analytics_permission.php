<?php
/**
 * Migration Script: Add project-analytics permission to Admin role
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    // 1. Get Admin Role ID
    $stmt = $pdo->prepare("SELECT id FROM platform_roles WHERE name = 'Admin'");
    $stmt->execute();
    $adminRoleId = $stmt->fetchColumn();

    if (!$adminRoleId) {
        throw new Exception("Role 'Admin' not found. Please verify the database initialization.");
    }

    // 2. Insert permission 'project-analytics'
    $permission = 'project-analytics';
    $stmtInsert = $pdo->prepare("INSERT IGNORE INTO platform_permissions (role_id, menu_item_id) VALUES (?, ?)");
    $stmtInsert->execute([$adminRoleId, $permission]);
    $affected = $stmtInsert->rowCount();

    echo json_encode([
        'success' => true,
        'message' => "Permission 'project-analytics' successfully assigned to Admin role.",
        'affected_rows' => $affected
    ], JSON_PRETTY_PRINT);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
