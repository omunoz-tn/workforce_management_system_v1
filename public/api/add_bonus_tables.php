<?php
/**
 * Migration Script: HR > Bonus
 *
 * Two steps, because a new module needs both to be usable:
 *   1. Creates `org_bonus_employees` (the per-month bonus list — see BonusSql.php).
 *   2. Grants the `bonus` sub-menu to the Admin role. A brand-new menu_item_id starts with
 *      zero rows in platform_permissions, so without this the sub-menu is invisible to
 *      everyone, Admin included. Other roles are opted in by hand from
 *      Configuration > User > Roles.
 *
 * Safe to re-run: CREATE TABLE IF NOT EXISTS is a no-op on an existing table, and the
 * permission goes in with INSERT IGNORE.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'BonusSql.php';

try {
    ensureBonusTables($pdo);

    $stmt = $pdo->prepare("SELECT id FROM platform_roles WHERE name = 'Admin'");
    $stmt->execute();
    $adminRoleId = $stmt->fetchColumn();

    if (!$adminRoleId) {
        throw new Exception("Role 'Admin' not found. Please verify the database initialization.");
    }

    $stmtInsert = $pdo->prepare("INSERT IGNORE INTO platform_permissions (role_id, menu_item_id) VALUES (?, ?)");
    $stmtInsert->execute([$adminRoleId, 'bonus']);
    $granted = $stmtInsert->rowCount();

    echo json_encode([
        'success' => true,
        'message' => 'org_bonus_employees table ready.',
        'permission' => $granted > 0
            ? "Permission 'bonus' assigned to Admin role."
            : "Permission 'bonus' was already assigned to Admin role."
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
