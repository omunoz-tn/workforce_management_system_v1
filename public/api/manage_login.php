<?php
/**
 * Login Management API
 * Handles Users, Roles, and Permission assignments
 */

header('Content-Type: application/json');
require_once 'db_wfm_config.php';

session_start();

// Security Guard: Only Admin can access this
if (!isset($_SESSION['user_id']) || $_SESSION['role_name'] !== 'Admin') {
    http_response_code(403);
    echo json_encode(['error' => 'Unauthorized access']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? 'list';

try {
    if ($method === 'GET') {
        if ($action === 'list_all') {
            // Get all users
            $stmt = $pdo->query("SELECT u.id, u.username, u.full_name, u.role_id, r.name as role_name, u.status, u.last_login 
                               FROM platform_users u 
                               LEFT JOIN platform_roles r ON u.role_id = r.id");
            $users = $stmt->fetchAll();

            // Get all roles
            $stmt = $pdo->query("SELECT * FROM platform_roles");
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
                $stmt = $pdo->prepare("INSERT INTO platform_users (username, password_hash, full_name, role_id) VALUES (?, ?, ?, ?)");
                $stmt->execute([
                    $input['username'],
                    password_hash($input['password'], PASSWORD_DEFAULT),
                    $input['full_name'],
                    $input['role_id']
                ]);
                echo json_encode(['success' => true, 'id' => $pdo->lastInsertId()]);
            } elseif ($subAction === 'update') {
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
                $stmt = $pdo->prepare("DELETE FROM platform_users WHERE id = ?");
                $stmt->execute([$input['id']]);
                echo json_encode(['success' => true]);
            }
        } elseif ($type === 'role') {
            if ($subAction === 'create') {
                $stmt = $pdo->prepare("INSERT INTO platform_roles (name) VALUES (?)");
                $stmt->execute([$input['name']]);
                echo json_encode(['success' => true, 'id' => $pdo->lastInsertId()]);
            } elseif ($subAction === 'update') {
                $stmt = $pdo->prepare("UPDATE platform_roles SET name = ? WHERE id = ?");
                $stmt->execute([$input['name'], $input['id']]);
                echo json_encode(['success' => true]);
            } elseif ($subAction === 'delete') {
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
