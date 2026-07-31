<?php
ini_set('display_errors', 0);
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);
date_default_timezone_set('America/Santo_Domingo');
// Database configuration for wfm_platform
// Load .env file
$envFile = dirname(__DIR__, 2) . '/.env';
$env = [];

// 1. Load .env file (Try root and one level up for portability)
$envFile = dirname(__DIR__, 2) . '/.env'; // Dev path: project-root/.env
if (!file_exists($envFile)) {
    $envFile = dirname(__DIR__, 1) . '/.env'; // Prod path: /var/www/html/.env
}

if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0)
            continue;
        $parts = explode('=', $line, 2);
        if (count($parts) === 2) {
            $env[trim($parts[0])] = trim($parts[1]);
        }
    }
}

// 2. Override with system environment variables (Docker/Server configuration)
$envVars = [
    'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS', 
    'DESKTIME_API_KEY_TN', 'DESKTIME_API_KEY_BAY',
    'ODOO_DB_HOST', 'ODOO_DB_USER', 'ODOO_DB_PASS', 'ODOO_DB_NAME', 'ODOO_DB_PORT'
];
foreach ($envVars as $var) {
    $val = getenv($var);
    if ($val !== false) {
        $env[$var] = $val;
    }
}

$host = $env['DB_HOST'] ?? 'localhost';
$dbname = $env['DB_NAME'] ?? 'wfm_platform';
$username = $env['DB_USER'] ?? 'root';
$password = $env['DB_PASS'] ?? '';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8", $username, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 5, // 5 seconds timeout
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}
?>