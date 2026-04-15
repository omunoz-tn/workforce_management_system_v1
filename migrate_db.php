<?php
require_once 'public/api/db_wfm_config.php';

// Migration script: Create desktime_project_data table
$sql = "CREATE TABLE IF NOT EXISTS desktime_project_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    employee_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    team_name VARCHAR(255),
    project_id INT,
    project_title VARCHAR(255),
    task_id INT,
    task_title VARCHAR(255),
    duration_seconds INT DEFAULT 0,
    log_date DATE NOT NULL,
    api_account VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_task_entry (employee_id, log_date, project_id, task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;";

try {
    $pdo->exec($sql);
    echo "SUCCESS: Table desktime_project_data created successfully.\n";
} catch (PDOException $e) {
    echo "DATABASE ERROR: " . $e->getMessage() . "\n";
}
?>
