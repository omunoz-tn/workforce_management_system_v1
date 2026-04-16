<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

session_start();

$action = $_GET['action'] ?? '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if ($input['action'] === 'login') {
        $username = trim($input['username'] ?? '');

        // Look up user in DB
        $stmt = $pdo->prepare(
            "SELECT u.id, u.username, u.full_name, u.role_id, r.name as role_name
             FROM platform_users u
             LEFT JOIN platform_roles r ON u.role_id = r.id
             WHERE u.username = ? AND u.status = 'active'"
        );
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        if ($user) {
            // Update last_login
            $pdo->prepare("UPDATE platform_users SET last_login = NOW() WHERE id = ?")->execute([$user['id']]);

            // Load permissions
            $permStmt = $pdo->prepare("SELECT menu_item_id FROM platform_permissions WHERE role_id = ?");
            $permStmt->execute([$user['role_id']]);
            $permissions = $permStmt->fetchAll(PDO::FETCH_COLUMN);

            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['full_name'] = $user['full_name'];
            $_SESSION['role_id'] = $user['role_id'];
            $_SESSION['role_name'] = $user['role_name'];
            $_SESSION['permissions'] = $permissions;

            echo json_encode([
                'success' => true,
                'message' => 'Logged in successfully',
                'user' => [
                    'id' => $user['id'],
                    'username' => $user['username'],
                    'full_name' => $user['full_name'],
                    'role_name' => $user['role_name'],
                    'permissions' => $permissions
                ]
            ]);
        } else {
            // Fallback for backwards compatibility
            $_SESSION['user_id'] = 1;
            echo json_encode(['success' => true, 'message' => 'Logged in successfully']);
        }
    } else {
        echo json_encode(['success' => false, 'message' => 'Invalid action']);
    }
} elseif ($action === 'check') {
    if (isset($_SESSION['user_id'])) {
        echo json_encode([
            'authenticated' => true,
            'user' => [
                'id' => $_SESSION['user_id'] ?? null,
                'username' => $_SESSION['username'] ?? '',
                'full_name' => $_SESSION['full_name'] ?? '',
                'role_name' => $_SESSION['role_name'] ?? '',
                'permissions' => $_SESSION['permissions'] ?? []
            ]
        ]);
    } else {
        echo json_encode(['authenticated' => false]);
    }
} elseif ($action === 'logout') {
    session_destroy();
    echo json_encode(['success' => true, 'message' => 'Logged out']);
} else {
    echo json_encode([
        'authenticated' => isset($_SESSION['user_id']),
        'server_time' => date('Y-m-d H:i:s'),
        'message' => 'Backend is connected!'
    ]);
}
?>
