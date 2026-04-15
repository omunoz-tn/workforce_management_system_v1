<?php
require_once 'public/api/db_wfm_config.php';

try {
    $stmt = $pdo->query("SHOW COLUMNS FROM desktime_employee_data LIKE 'is_billable'");
    $exists = $stmt->fetch();
    
    if (!$exists) {
        $pdo->exec("ALTER TABLE desktime_employee_data ADD COLUMN is_billable TINYINT(1) DEFAULT 1");
        echo "Column is_billable added successfully.\n";
    } else {
        echo "Column is_billable already exists.\n";
    }
} catch (PDOException $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
?>
