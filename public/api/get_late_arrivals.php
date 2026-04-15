<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $query = "SELECT name, group_name, arrived, work_starts 
              FROM desktime_employee_data 
              WHERE arrived IS NOT NULL 
              AND log_date = CURDATE()
              ORDER BY group_name ASC, arrived DESC";

    $stmt = $pdo->query($query);
    $lateArrivals = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $lateArrivals
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>