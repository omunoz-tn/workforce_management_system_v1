<?php
require_once 'db_wfm_config.php';
try {
    $stmt = $pdo->query('SELECT log_date, COUNT(*) as count FROM desktime_employee_data GROUP BY log_date ORDER BY log_date DESC LIMIT 5');
    print_r($stmt->fetchAll(PDO::FETCH_ASSOC));
} catch (Exception $e) {
    echo $e->getMessage();
}
