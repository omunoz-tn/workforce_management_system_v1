<?php
/**
 * Migration Script: platform_roles.is_system + platform_roles.team_scope
 *
 * is_system  -- marks the built-in administrator role. Authorization used to be
 *               decided by comparing the role NAME against the literal 'Admin' in
 *               ten different endpoints, so renaming that role from the UI locked
 *               every admin out of user management with no in-app way back.
 *
 * team_scope -- makes the data scope of a role explicit. An empty team list used to
 *               mean "sees every team", so clearing the checkboxes on a restricted
 *               role silently widened its access instead of narrowing it. Now
 *               'all' is the only thing that grants global access and 'selected'
 *               with nothing selected means no rows.
 *
 * Both columns are seeded to reproduce exactly what each role can see today, so
 * running this changes nobody's access.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $report = [];

    $hasIsSystem = $pdo->query("SHOW COLUMNS FROM platform_roles LIKE 'is_system'")->fetch();
    if (!$hasIsSystem) {
        $pdo->exec("ALTER TABLE platform_roles ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0");
        $flagged = $pdo->exec("UPDATE platform_roles SET is_system = 1 WHERE name = 'Admin'");
        $report['is_system'] = "added, flagged $flagged role(s) named 'Admin'";
    } else {
        $report['is_system'] = 'already present';
    }

    $hasTeamScope = $pdo->query("SHOW COLUMNS FROM platform_roles LIKE 'team_scope'")->fetch();
    if (!$hasTeamScope) {
        $pdo->exec("ALTER TABLE platform_roles
                    ADD COLUMN team_scope ENUM('all','selected') NOT NULL DEFAULT 'selected'");
        // Preserve today's behaviour: no team rows meant unrestricted.
        $pdo->exec("UPDATE platform_roles r
                    SET r.team_scope = CASE
                        WHEN EXISTS (SELECT 1 FROM platform_role_teams t WHERE t.role_id = r.id)
                        THEN 'selected' ELSE 'all' END");
        $report['team_scope'] = 'added and seeded from existing team assignments';
    } else {
        $report['team_scope'] = 'already present';
    }

    $roles = $pdo->query("SELECT r.name, r.is_system, r.team_scope,
                                 (SELECT COUNT(*) FROM platform_role_teams t WHERE t.role_id = r.id) AS teams
                          FROM platform_roles r ORDER BY r.name")->fetchAll();

    echo json_encode([
        'success' => true,
        'changes' => $report,
        'roles' => $roles
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()], JSON_PRETTY_PRINT);
}
?>
