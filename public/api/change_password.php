<?php
/**
 * change_password.php
 * Self-service password change for the currently logged-in user.
 * Scoped by the session's user_id (never a client-supplied id) — same
 * verify/hash approach as auth.php (login) and manage_login.php (admin
 * user management): password_verify()/password_hash() with PASSWORD_DEFAULT.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$sessionLifetime = 8 * 60 * 60;
ini_set('session.gc_maxlifetime', $sessionLifetime);
session_set_cookie_params($sessionLifetime);
session_start();

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Not authenticated']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

try {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $currentPassword = $input['current_password'] ?? '';
    $newPassword = $input['new_password'] ?? '';

    if (empty($currentPassword) || empty($newPassword)) {
        throw new Exception('Current password and new password are required.');
    }
    if (strlen($newPassword) < 6) {
        throw new Exception('New password must be at least 6 characters.');
    }

    $stmt = $pdo->prepare("SELECT password_hash FROM platform_users WHERE id = ?");
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($currentPassword, $user['password_hash'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Current password is incorrect.']);
        exit;
    }

    $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
    $update = $pdo->prepare("UPDATE platform_users SET password_hash = ? WHERE id = ?");
    $update->execute([$newHash, $_SESSION['user_id']]);

    echo json_encode(['success' => true, 'message' => 'Password updated successfully.']);
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
