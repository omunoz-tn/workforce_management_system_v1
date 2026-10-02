<?php
/**
 * Migration Script: Configuration > HR > Company
 *
 * Two steps, because a new settings screen needs both to be usable:
 *   1. Creates `org_companies` (the company lookup list -- see Companies.php).
 *   2. Grants the `settings-hr` sub-menu to the Admin role. A brand-new menu_item_id starts
 *      with zero rows in platform_permissions, so without this the entry is invisible to
 *      everyone, Admin included. Other roles are opted in by hand from
 *      Configuration > User > Roles.
 *
 * Safe to re-run: CREATE TABLE IF NOT EXISTS is a no-op on an existing table, and the
 * permission goes in with INSERT IGNORE.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'Companies.php';

try {
    ensureCompaniesTable($pdo);

    $stmt = $pdo->prepare("SELECT id FROM platform_roles WHERE name = 'Admin'");
    $stmt->execute();
    $adminRoleId = $stmt->fetchColumn();

    if (!$adminRoleId) {
        throw new Exception("Role 'Admin' not found. Please verify the database initialization.");
    }

    $stmtInsert = $pdo->prepare("INSERT IGNORE INTO platform_permissions (role_id, menu_item_id) VALUES (?, ?)");
    $stmtInsert->execute([$adminRoleId, 'settings-hr']);
    $granted = $stmtInsert->rowCount();

    echo json_encode([
        'success' => true,
        'message' => 'org_companies table ready.',
        'permission' => $granted > 0
            ? "Permission 'settings-hr' assigned to Admin role."
            : "Permission 'settings-hr' was already assigned to Admin role."
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
