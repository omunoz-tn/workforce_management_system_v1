<?php
/**
 * Login Management API
 * Handles Users, Roles, and Permission assignments
 */

header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';

session_start();

// Security Guard: only the built-in admin role reaches this. Keyed off the
// is_system flag rather than the role's name, which admins can edit.
if (!isset($_SESSION['user_id']) || !current_is_admin()) {
    http_response_code(403);
    echo json_encode(['error' => 'Unauthorized access']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? 'list';

const DEFAULT_PASSWORD_KEY = 'default_user_password';

/**
 * Creates platform_settings on demand so the Default Password tab works even
 * when add_platform_settings_table.php has not been run against this database.
 */
function ensure_settings_table($pdo) {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `platform_settings` (
          `setting_key` varchar(64) NOT NULL,
          `setting_value` text DEFAULT NULL,
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`setting_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");
}

/**
 * Clear-text default password applied to new users. Returns '' when unset (or
 * when the settings table does not exist yet, so reads never hard-fail).
 */
function get_default_password($pdo) {
    try {
        $stmt = $pdo->prepare("SELECT setting_value FROM platform_settings WHERE setting_key = ?");
        $stmt->execute([DEFAULT_PASSWORD_KEY]);
        $value = $stmt->fetchColumn();
        return $value === false || $value === null ? '' : (string) $value;
    } catch (PDOException $e) {
        return '';
    }
}

/**
 * Adds the access-flag columns on demand, so the protections below hold even when
 * add_platform_roles_access_flags.php has not been run against this database.
 * ALTER TABLE commits implicitly, so this must never run inside a transaction.
 */
function ensure_role_access_flags($pdo) {
    if (!$pdo->query("SHOW COLUMNS FROM platform_roles LIKE 'is_system'")->fetch()) {
        $pdo->exec("ALTER TABLE platform_roles ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0");
        $pdo->exec("UPDATE platform_roles SET is_system = 1 WHERE name = 'Admin'");
    }
    if (!$pdo->query("SHOW COLUMNS FROM platform_roles LIKE 'team_scope'")->fetch()) {
        $pdo->exec("ALTER TABLE platform_roles
                    ADD COLUMN team_scope ENUM('all','selected') NOT NULL DEFAULT 'selected'");
        $pdo->exec("UPDATE platform_roles r
                    SET r.team_scope = CASE
                        WHEN EXISTS (SELECT 1 FROM platform_role_teams t WHERE t.role_id = r.id)
                        THEN 'selected' ELSE 'all' END");
    }
}

/** The built-in admin role cannot be renamed or deleted -- see the migration's notes. */
function is_system_role($pdo, $roleId) {
    ensure_role_access_flags($pdo);
    $stmt = $pdo->prepare("SELECT is_system FROM platform_roles WHERE id = ?");
    $stmt->execute([$roleId]);
    return !empty($stmt->fetchColumn());
}

/**
 * Active users on a system role, ignoring $excludeUserId. Used to refuse any change
 * that would leave the platform with nobody who can reach user management -- a state
 * only recoverable with direct database access.
 */
function count_other_active_admins($pdo, $excludeUserId) {
    ensure_role_access_flags($pdo);
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM platform_users u
                           JOIN platform_roles r ON u.role_id = r.id
                           WHERE u.status = 'active' AND r.is_system = 1 AND u.id <> ?");
    $stmt->execute([$excludeUserId]);
    return (int) $stmt->fetchColumn();
}

/**
 * Adds platform_roles.sort_order on demand, so role reordering works even when
 * add_platform_roles_sort_order.php has not been run against this database.
 * ALTER TABLE commits implicitly in MySQL, so this must never run inside a
 * transaction -- every caller invokes it before beginTransaction().
 */
function ensure_roles_sort_order($pdo) {
    $exists = $pdo->query("SHOW COLUMNS FROM platform_roles LIKE 'sort_order'")->fetch();
    if (!$exists) {
        $pdo->exec("ALTER TABLE platform_roles ADD COLUMN sort_order INT NOT NULL DEFAULT 0");
        $pdo->exec("UPDATE platform_roles SET sort_order = id");
    }
}

/**
 * platform_roles.name is UNIQUE (uq_role_name, utf8mb4_unicode_ci so the match is
 * case-insensitive), so a duplicate needs a name that is free. Returns the first
 * unused "<name> (Copy)" / "<name> (Copy N)", trimmed to the column's 100 chars,
 * or '' when 50 variants are all taken.
 */
function suggest_copy_name($pdo, $baseName) {
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM platform_roles WHERE name = ?");
    for ($i = 1; $i <= 50; $i++) {
        $suffix = $i === 1 ? ' (Copy)' : " (Copy $i)";
        $candidate = mb_substr($baseName, 0, 100 - mb_strlen($suffix)) . $suffix;
        $stmt->execute([$candidate]);
        if ((int) $stmt->fetchColumn() === 0) {
            return $candidate;
        }
    }
    return '';
}

try {
    if ($method === 'GET') {
        if ($action === 'list_all') {
            // Get all users
            $stmt = $pdo->query("SELECT u.id, u.username, u.full_name, u.role_id, r.name as role_name, u.status, u.last_login 
                               FROM platform_users u 
                               LEFT JOIN platform_roles r ON u.role_id = r.id");
            $users = $stmt->fetchAll();

            // Get all roles, in the order set from Roles & Access. Falls back to an
            // unordered read when sort_order has not been added yet.
            ensure_role_access_flags($pdo);
            try {
                $stmt = $pdo->query("SELECT * FROM platform_roles ORDER BY sort_order ASC, name ASC");
            } catch (PDOException $e) {
                $stmt = $pdo->query("SELECT * FROM platform_roles");
            }
            $roles = $stmt->fetchAll();

            // Get all permissions
            $stmt = $pdo->query("SELECT * FROM platform_permissions");
            $permissions = $stmt->fetchAll();

            // Get all role-team assignments
            $stmt = $pdo->query("SELECT * FROM platform_role_teams");
            $roleTeams = $stmt->fetchAll();

            // Get all available teams from org_teams
            $stmt = $pdo->query("SELECT id, name FROM org_teams ORDER BY name ASC");
            $orgTeams = $stmt->fetchAll();

            echo json_encode([
                'success' => true,
                'current_user_id' => $_SESSION['user_id'],
                'default_password' => get_default_password($pdo),
                'users' => $users,
                'roles' => $roles,
                'permissions' => $permissions,
                'role_teams' => $roleTeams,
                'org_teams' => $orgTeams
            ]);
        }
    } elseif ($method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $type = $input['type'] ?? ''; // user, role, permission
        $subAction = $input['action'] ?? ''; // create, update, delete

        if ($type === 'user') {
            if ($subAction === 'create') {
                // A blank password on create falls back to the configured default,
                // so new users always land with the Default Password tab's value.
                $password = $input['password'] ?? '';
                if ($password === '') {
                    $password = get_default_password($pdo);
                }
                if ($password === '') {
                    echo json_encode(['success' => false, 'error' => 'A password is required. Set one here or configure a Default Password.']);
                    exit;
                }

                $stmt = $pdo->prepare("INSERT INTO platform_users (username, password_hash, full_name, role_id, status) VALUES (?, ?, ?, ?, ?)");
                $stmt->execute([
                    $input['username'],
                    password_hash($password, PASSWORD_DEFAULT),
                    $input['full_name'],
                    $input['role_id'],
                    $input['status'] ?? 'active'
                ]);
                echo json_encode(['success' => true, 'id' => $pdo->lastInsertId()]);
            } elseif ($subAction === 'update') {
                $targetId = $input['id'] ?? null;
                $isSelf = (string) $targetId === (string) $_SESSION['user_id'];
                $keepsAdmin = is_system_role($pdo, $input['role_id'] ?? null)
                    && ($input['status'] ?? 'active') === 'active';

                if ($isSelf && !$keepsAdmin) {
                    echo json_encode(['success' => false, 'error' => 'You cannot remove your own administrator access. Ask another administrator to do it.']);
                    exit;
                }
                if (!$keepsAdmin && count_other_active_admins($pdo, $targetId) === 0) {
                    echo json_encode(['success' => false, 'error' => 'This is the last active administrator. Promote another user first.']);
                    exit;
                }

                if (!empty($input['password'])) {
                    $stmt = $pdo->prepare("UPDATE platform_users SET username = ?, password_hash = ?, full_name = ?, role_id = ?, status = ? WHERE id = ?");
                    $stmt->execute([
                        $input['username'],
                        password_hash($input['password'], PASSWORD_DEFAULT),
                        $input['full_name'],
                        $input['role_id'],
                        $input['status'],
                        $input['id']
                    ]);
                } else {
                    $stmt = $pdo->prepare("UPDATE platform_users SET username = ?, full_name = ?, role_id = ?, status = ? WHERE id = ?");
                    $stmt->execute([
                        $input['username'],
                        $input['full_name'],
                        $input['role_id'],
                        $input['status'],
                        $input['id']
                    ]);
                }
                echo json_encode(['success' => true]);
            } elseif ($subAction === 'delete') {
                $targetId = $input['id'] ?? null;

                if ((string) $targetId === (string) $_SESSION['user_id']) {
                    echo json_encode(['success' => false, 'error' => 'You cannot delete your own account.']);
                    exit;
                }
                if (count_other_active_admins($pdo, $targetId) === 0) {
                    echo json_encode(['success' => false, 'error' => 'This is the last active administrator. Promote another user first.']);
                    exit;
                }

                $stmt = $pdo->prepare("DELETE FROM platform_users WHERE id = ?");
                $stmt->execute([$targetId]);
                echo json_encode(['success' => true]);
            }
        } elseif ($type === 'role') {
            if ($subAction === 'create') {
                ensure_roles_sort_order($pdo);
                $nextOrder = (int) $pdo->query("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM platform_roles")->fetchColumn();
                $stmt = $pdo->prepare("INSERT INTO platform_roles (name, sort_order) VALUES (?, ?)");
                $stmt->execute([$input['name'], $nextOrder]);
                echo json_encode(['success' => true, 'id' => $pdo->lastInsertId()]);
            } elseif ($subAction === 'update') {
                if (is_system_role($pdo, $input['id'] ?? null)) {
                    echo json_encode(['success' => false, 'error' => 'The built-in administrator role cannot be renamed.']);
                    exit;
                }
                $stmt = $pdo->prepare("UPDATE platform_roles SET name = ? WHERE id = ?");
                $stmt->execute([$input['name'], $input['id']]);
                echo json_encode(['success' => true]);
            } elseif ($subAction === 'duplicate') {
                $sourceId = $input['source_id'] ?? null;
                ensure_roles_sort_order($pdo);
                $stmt = $pdo->prepare("SELECT id, name, sort_order, team_scope FROM platform_roles WHERE id = ?");
                $stmt->execute([$sourceId]);
                $source = $stmt->fetch();
                if (!$source) {
                    echo json_encode(['success' => false, 'error' => 'The role being duplicated no longer exists.']);
                    exit;
                }

                $name = trim($input['name'] ?? '');
                if ($name === '') {
                    $name = suggest_copy_name($pdo, $source['name']);
                }
                if ($name === '') {
                    echo json_encode(['success' => false, 'error' => 'Could not derive a free name for the copy. Enter one manually.']);
                    exit;
                }
                if (mb_strlen($name) > 100) {
                    echo json_encode(['success' => false, 'error' => 'Role name cannot exceed 100 characters.']);
                    exit;
                }

                $check = $pdo->prepare("SELECT COUNT(*) FROM platform_roles WHERE name = ?");
                $check->execute([$name]);
                if ((int) $check->fetchColumn() > 0) {
                    echo json_encode(['success' => false, 'error' => 'A role named "' . $name . '" already exists.']);
                    exit;
                }

                $pdo->beginTransaction();

                // Open a slot right below the source so the copy sits next to it
                $sourceOrder = (int) $source['sort_order'];
                $shift = $pdo->prepare("UPDATE platform_roles SET sort_order = sort_order + 1 WHERE sort_order > ?");
                $shift->execute([$sourceOrder]);

                $stmt = $pdo->prepare("INSERT INTO platform_roles (name, sort_order, team_scope) VALUES (?, ?, ?)");
                $stmt->execute([$name, $sourceOrder + 1, $source['team_scope'] ?? 'selected']);
                $newRoleId = $pdo->lastInsertId();

                // Copy module permissions and team access in bulk, so the duplicate
                // starts out with exactly the source role's access.
                $stmt = $pdo->prepare("INSERT INTO platform_permissions (role_id, menu_item_id)
                                       SELECT ?, menu_item_id FROM platform_permissions WHERE role_id = ?");
                $stmt->execute([$newRoleId, $source['id']]);
                $copiedPermissions = $stmt->rowCount();

                $stmt = $pdo->prepare("INSERT INTO platform_role_teams (role_id, team_id)
                                       SELECT ?, team_id FROM platform_role_teams WHERE role_id = ?");
                $stmt->execute([$newRoleId, $source['id']]);
                $copiedTeams = $stmt->rowCount();

                $pdo->commit();

                echo json_encode([
                    'success' => true,
                    'id' => $newRoleId,
                    'name' => $name,
                    'copied_permissions' => $copiedPermissions,
                    'copied_teams' => $copiedTeams
                ]);
            } elseif ($subAction === 'set_team_scope') {
                $scope = ($input['team_scope'] ?? '') === 'all' ? 'all' : 'selected';
                ensure_role_access_flags($pdo);
                $stmt = $pdo->prepare("UPDATE platform_roles SET team_scope = ? WHERE id = ?");
                $stmt->execute([$scope, $input['id'] ?? null]);
                echo json_encode(['success' => true, 'team_scope' => $scope]);
            } elseif ($subAction === 'reorder') {
                $roleIds = $input['role_ids'] ?? [];
                if (!is_array($roleIds) || count($roleIds) === 0) {
                    echo json_encode(['success' => false, 'error' => 'No role order was supplied.']);
                    exit;
                }

                ensure_roles_sort_order($pdo);
                $pdo->beginTransaction();

                $stmt = $pdo->prepare("UPDATE platform_roles SET sort_order = ? WHERE id = ?");
                $position = 1;
                foreach ($roleIds as $roleId) {
                    if (!is_numeric($roleId)) continue;
                    $stmt->execute([$position, (int) $roleId]);
                    $position++;
                }

                $pdo->commit();
                echo json_encode(['success' => true, 'ordered' => $position - 1]);
            } elseif ($subAction === 'delete') {
                if (is_system_role($pdo, $input['id'] ?? null)) {
                    echo json_encode(['success' => false, 'error' => 'The built-in administrator role cannot be deleted.']);
                    exit;
                }

                // Check if role is in use
                $check = $pdo->prepare("SELECT COUNT(*) FROM platform_users WHERE role_id = ?");
                $check->execute([$input['id']]);
                if ($check->fetchColumn() > 0) {
                    echo json_encode(['success' => false, 'error' => 'Cannot delete role because it is currently assigned to one or more users.']);
                    exit;
                }
                
                $stmt = $pdo->prepare("DELETE FROM platform_roles WHERE id = ?");
                $stmt->execute([$input['id']]);
                echo json_encode(['success' => true]);
            }
        } elseif ($type === 'permission') {
            if ($subAction === 'sync') {
                $pdo->beginTransaction();
                // Clear existing for this role
                $stmt = $pdo->prepare("DELETE FROM platform_permissions WHERE role_id = ?");
                $stmt->execute([$input['role_id']]);

                // Insert new ones
                $stmt = $pdo->prepare("INSERT INTO platform_permissions (role_id, menu_item_id) VALUES (?, ?)");
                foreach ($input['permissions'] as $perm) {
                    $stmt->execute([$input['role_id'], $perm]);
                }
                $pdo->commit();
                echo json_encode(['success' => true]);
            }
        } elseif ($type === 'setting') {
            if ($subAction === 'save_default_password') {
                $password = trim($input['password'] ?? '');
                ensure_settings_table($pdo);
                $stmt = $pdo->prepare("INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
                                       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)");
                $stmt->execute([DEFAULT_PASSWORD_KEY, $password]);
                echo json_encode(['success' => true, 'default_password' => $password]);
            }
        } elseif ($type === 'role_team') {
            if ($subAction === 'sync') {
                $pdo->beginTransaction();
                // Clear existing team assignments for this role
                $stmt = $pdo->prepare("DELETE FROM platform_role_teams WHERE role_id = ?");
                $stmt->execute([$input['role_id']]);

                // Insert new team assignments
                if (!empty($input['team_ids'])) {
                    $stmt = $pdo->prepare("INSERT INTO platform_role_teams (role_id, team_id) VALUES (?, ?)");
                    foreach ($input['team_ids'] as $teamId) {
                        $stmt->execute([$input['role_id'], $teamId]);
                    }
                }
                $pdo->commit();
                echo json_encode(['success' => true]);
            }
        }
    }
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
