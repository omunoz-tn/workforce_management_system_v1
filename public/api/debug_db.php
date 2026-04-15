<?php
require_once 'db_wfm_config.php';
$stmt = $pdo->query("SELECT name, arrived, work_starts, is_late FROM desktime_employee_data WHERE work_starts = '00:00:00' AND arrived IS NOT NULL LIMIT 10");
$data = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo json_encode($data, JSON_PRETTY_PRINT);
?>