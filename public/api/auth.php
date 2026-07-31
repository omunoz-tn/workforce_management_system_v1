<?php
/**
 * Authentication Service
 * Handles Login, Session Validation, and Logout
 */

header('Content-Type: application/json');
require_once 'db_wfm_config.php';

// Configure session lifetime (8 hours as requested)
$sessionLifetime = 8 * 60 * 60; // 28800 seconds
ini_set('session.gc_maxlifetime', $sessionLifetime);
session_set_cookie_params($sessionLifetime);
session_start();

$action = $_GET['action'] ?? 'check';

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if ($action === 'login') {
            $input = json_decode(file_get_contents('php://input'), true);
            $username = $input['username'] ?? '';
            $password = $input['password'] ?? '';

            if (empty($username) || empty($password)) {
                throw new Exception("Username and password are required.");
            }

            // Find user
            $stmt = $pdo->prepare("SELECT u.*, r.name as role_name 
                                  FROM platform_users u 
                                  LEFT JOIN platform_roles r ON u.role_id = r.id 
                                  WHERE u.username = ? AND u.status = 'active'");
            $stmt->execute([$username]);
            $user = $stmt->fetch();

            if ($user && password_verify($password, $user['password_hash'])) {
                // Success - Set session
                $_SESSION['user_id'] = $user['id'];
                $_SESSION['username'] = $user['username'];
                $_SESSION['role_id'] = $user['role_id'];
                $_SESSION['role_name'] = $user['role_name'];
                $_SESSION['full_name'] = $user['full_name'];

                // Load permissions (menu item IDs)
                $stmtPerms = $pdo->prepare("SELECT menu_item_id FROM platform_permissions WHERE role_id = ?");
                $stmtPerms->execute([$user['role_id']]);
                $_SESSION['permissions'] = $stmtPerms->fetchAll(PDO::FETCH_COLUMN);

                // Load allowed team IDs
                $stmtTeams = $pdo->prepare("SELECT team_id FROM platform_role_teams WHERE role_id = ?");
                $stmtTeams->execute([$user['role_id']]);
                $_SESSION['allowed_teams'] = $stmtTeams->fetchAll(PDO::FETCH_COLUMN);

                // Update last login
                $update = $pdo->prepare("UPDATE platform_users SET last_login = NOW() WHERE id = ?");
                $update->execute([$user['id']]);

                echo json_encode([
                    'success' => true,
                    'message' => 'Logged in successfully',
                    'user' => [
                        'username' => $user['username'],
                        'full_name' => $user['full_name'],
                        'role' => $user['role_name'],
                        'permissions' => $_SESSION['permissions'],
                        'allowedTeams' => $_SESSION['allowed_teams']
                    ]
                ]);
            } else {
                http_response_code(401);
                echo json_encode(['success' => false, 'message' => 'Invalid credentials or inactive account']);
            }
        } elseif ($action === 'logout') {
            session_destroy();
            echo json_encode(['success' => true, 'message' => 'Logged out successfully']);
        }
    } else {
        // GET / ?action=check (Check session status)
        if (isset($_SESSION['user_id'])) {
            // Reload permissions dynamically
            $stmtPerms = $pdo->prepare("SELECT menu_item_id FROM platform_permissions WHERE role_id = ?");
            $stmtPerms->execute([$_SESSION['role_id']]);
            $_SESSION['permissions'] = $stmtPerms->fetchAll(PDO::FETCH_COLUMN);

            echo json_encode([
                'authenticated' => true,
                'user' => [
                    'username' => $_SESSION['username'],
                    'full_name' => $_SESSION['full_name'],
                    'role' => $_SESSION['role_name'],
                    'permissions' => $_SESSION['permissions'],
                    'allowedTeams' => $_SESSION['allowed_teams'] ?? []
                ]
            ]);
        } else {
            echo json_encode([
                'authenticated' => false,
                'message' => 'Not authenticated'
            ]);
        }
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}