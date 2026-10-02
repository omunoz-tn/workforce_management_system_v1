<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';

session_start();

try {
    $query = "SELECT d.name, d.group_name, d.arrived, d.work_starts 
              FROM desktime_employee_data d
              LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
              WHERE d.arrived IS NOT NULL 
              AND d.log_date = CURDATE()";
    
    $query .= team_filter_sql('ota.team_id');

    $query .= " ORDER BY d.group_name ASC, d.arrived DESC";

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