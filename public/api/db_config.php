<?php
// Secure database configuration
// In production, this should ideally be outside the web root or set via ENV variables.
// For this portable setup, we use a PHP file that returns the connection but is protected by .htaccess

$host = 'localhost';
$dbname = 'workforce_db';
$username = 'root';
$password = '';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    // In production, don't echo the error directly to avoid leaking paths
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}
?>
