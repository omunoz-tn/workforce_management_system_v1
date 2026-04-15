<?php
require_once 'db_wfm_config.php';
$stmt = $pdo->query("DESCRIBE desktime_employee_data");
$data = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo json_encode($data, JSON_PRETTY_PRINT);
?>