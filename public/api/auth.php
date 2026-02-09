<?php
header('Content-Type: application/json');
require_once 'db_config.php';

// Simulate simple auth or return session status
// This file is used to verify backend connectivity

session_start();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Basic login logic (replace with real auth)
    $input = json_decode(file_get_contents('php://input'), true);
    if ($input['action'] === 'login') {
        $_SESSION['user_id'] = 1;
        echo json_encode(['success' => true, 'message' => 'Logged in successfully']);
    } else {
        echo json_encode(['success' => false, 'message' => 'Invalid action']);
    }
} else {
    // Check if logged in
    echo json_encode([
        'authenticated' => isset($_SESSION['user_id']),
        'server_time' => date('Y-m-d H:i:s'),
        'message' => 'Backend is connected!'
    ]);
}
?>
