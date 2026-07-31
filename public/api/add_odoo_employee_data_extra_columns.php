<?php
/**
 * Migration Script: Add desktime_id, entry_date, work_email, work_phone, job_title,
 * work_location, user_login, personal_email, personal_phone and personal_mobile
 * columns to odoo_employee_data.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$columns = [
    'desktime_id' => "VARCHAR(255) DEFAULT NULL AFTER private_zip",
    'entry_date' => "DATE DEFAULT NULL AFTER desktime_id",
    'work_email' => "VARCHAR(255) DEFAULT NULL AFTER entry_date",
    'work_phone' => "VARCHAR(50) DEFAULT NULL AFTER work_email",
    'job_title' => "VARCHAR(255) DEFAULT NULL AFTER work_phone",
    'work_location' => "VARCHAR(255) DEFAULT NULL AFTER job_title",
    'user_login' => "VARCHAR(255) DEFAULT NULL AFTER work_location",
    'personal_email' => "VARCHAR(255) DEFAULT NULL AFTER user_login",
    'personal_phone' => "VARCHAR(50) DEFAULT NULL AFTER personal_email",
    'personal_mobile' => "VARCHAR(50) DEFAULT NULL AFTER personal_phone",
];

try {
    $added = [];
    $skipped = [];

    foreach ($columns as $name => $definition) {
        $check = $pdo->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'odoo_employee_data'
            AND COLUMN_NAME = :name");
        $check->execute(['name' => $name]);
        $exists = (int) $check->fetchColumn() > 0;

        if ($exists) {
            $skipped[] = $name;
            continue;
        }

        $pdo->exec("ALTER TABLE odoo_employee_data ADD COLUMN $name $definition");
        $added[] = $name;
    }

    echo json_encode([
        'success' => true,
        'added' => $added,
        'already_existed' => $skipped
    ], JSON_PRETTY_PRINT);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
?>
