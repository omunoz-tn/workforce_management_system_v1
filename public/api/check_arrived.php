<?php
require_once 'db_wfm_config.php';
try {
    $stmt = $pdo->query("SELECT name, arrived, work_starts, is_late FROM desktime_employee_data WHERE log_date = CURDATE() AND arrived IS NOT NULL AND work_starts != '00:00:00' LIMIT 5");
    print_r($stmt->fetchAll(PDO::FETCH_ASSOC));
} catch (Exception $e) {
    echo $e->getMessage();
}
