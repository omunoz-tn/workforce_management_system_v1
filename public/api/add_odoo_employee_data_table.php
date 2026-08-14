<?php
/**
 * Migration Script: Create odoo_employee_data table
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS odoo_employee_data (
            employee_id INT PRIMARY KEY,
            employee_name VARCHAR(255),
            is_active TINYINT(1) DEFAULT 1,
            identification_number VARCHAR(255),
            gender VARCHAR(50),
            date_of_birth DATE,
            marital_status VARCHAR(100),
            country_name VARCHAR(100),
            site_country_name VARCHAR(100),
            company_name VARCHAR(255),
            department_name VARCHAR(255),
            private_city VARCHAR(255),
            private_state VARCHAR(255),
            private_zip VARCHAR(50),
            desktime_id VARCHAR(255),
            entry_date DATE,
            work_email VARCHAR(255),
            work_phone VARCHAR(50),
            job_title VARCHAR(255),
            work_location VARCHAR(255),
            user_login VARCHAR(255),
            personal_email VARCHAR(255),
            personal_phone VARCHAR(50),
            personal_mobile VARCHAR(50),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    echo json_encode([
        'success' => true,
        'message' => 'odoo_employee_data table ready.'
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
