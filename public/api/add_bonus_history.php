<?php
/**
 * Migration Script: HR > History
 *
 *   1. Creates `org_bonus_audit_log` (the Bonus change log — see BonusAudit.php).
 *   2. Grants the `hr-history` sub-menu to the Admin role, without which the entry is
 *      invisible to everyone. Other roles are opted in by hand from
 *      Configuration > User > Roles.
 *
 * Safe to re-run.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'BonusAudit.php';

try {
    ensureBonusAuditTable($pdo);

    $stmt = $pdo->prepare("SELECT id FROM platform_roles WHERE name = 'Admin'");
    $stmt->execute();
    $adminRoleId = $stmt->fetchColumn();

    if (!$adminRoleId) {
        throw new Exception("Role 'Admin' not found. Please verify the database initialization.");
    }

    $stmtInsert = $pdo->prepare("INSERT IGNORE INTO platform_permissions (role_id, menu_item_id) VALUES (?, ?)");
    $stmtInsert->execute([$adminRoleId, 'hr-history']);
    $granted = $stmtInsert->rowCount();

    echo json_encode([
        'success' => true,
        'message' => 'org_bonus_audit_log table ready.',
        'permission' => $granted > 0
            ? "Permission 'hr-history' assigned to Admin role."
            : "Permission 'hr-history' was already assigned to Admin role."
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()], JSON_PRETTY_PRINT);
}
?>
