<?php
/**
 * user_presence.php
 *
 * POST -> heartbeat: marks the logged-in user as online (sent by every open tab each minute).
 * GET  -> admins only: the users online right now, for the sidebar status dot's tooltip.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'UserPresence.php';

session_start();
$userId = isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : 0;
// The heartbeat must not hold the session lock while it talks to the DB.
session_write_close();

try {
    if ($userId <= 0) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Not authenticated']);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        touchUserPresence($pdo, $userId);
        echo json_encode(['success' => true]);
        exit;
    }

    if (!current_is_admin()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Admins only']);
        exit;
    }

    echo json_encode([
        'success' => true,
        'online_window_seconds' => USER_PRESENCE_ONLINE_SECONDS,
        'users' => fetchOnlineUsers($pdo),
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
