<?php
/**
 * Migration Script: grant every sub-menu permission to the Admin role.
 *
 * The permissions grid used to list top-level modules ("Dashboard"); it now lists
 * each sub-menu ("Real Time", "Infograph", "Projects & Task", ...). The new ids
 * have to exist for Admin, otherwise those sub-menus disappear from the sidebar
 * for everyone. Safe to re-run: INSERT IGNORE skips ids already granted.
 *
 * Keep this list in sync with PERMISSION_MODULES in src/menuConfig.js.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$permissions = [
    // Dashboard
    'dashboard', 'infograph', 'project-analytics',
    // Employees
    'all-emp', 'odoo-emp', 'employee-roster', 'teams', 'billable',
    // Analytics
    'reports', 'kpi', 'databases', 'save-hours', 'save-projects',
    // Scheduling
    'schedule-board', 'shift-management', 'forecast', 'holidays', 'coverage',
    'time-off', 'templates', 'shift-swaps', 'history',
    // Configuration
    'settings-dashboard', 'settings-reports', 'settings-scheduling', 'org',
    'login-mgmt', 'shift-types', 'abs-types', 'notifications',
];

try {
    $stmt = $pdo->prepare("SELECT id FROM platform_roles WHERE name = 'Admin'");
    $stmt->execute();
    $adminRoleId = $stmt->fetchColumn();

    if (!$adminRoleId) {
        throw new Exception("Role 'Admin' not found. Please verify the database initialization.");
    }

    $stmtInsert = $pdo->prepare("INSERT IGNORE INTO platform_permissions (role_id, menu_item_id) VALUES (?, ?)");
    $granted = [];
    foreach ($permissions as $permission) {
        $stmtInsert->execute([$adminRoleId, $permission]);
        if ($stmtInsert->rowCount() > 0) {
            $granted[] = $permission;
        }
    }

    echo json_encode([
        'success' => true,
        'message' => count($granted) . " new permission(s) assigned to Admin role.",
        'granted' => $granted,
        'already_present' => count($permissions) - count($granted)
    ], JSON_PRETTY_PRINT);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
