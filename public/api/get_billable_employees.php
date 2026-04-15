<?php
// Disable error output for clean JSON
ini_set('display_errors', 0);
error_reporting(0);

header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    // Get the most recent info for each employee
    $sql = "SELECT d.name, d.group_name as team, d.employee_id, COALESCE(d.is_billable, 1) as is_billable
            FROM desktime_employee_data d
            INNER JOIN (
                SELECT employee_id, MAX(log_date) as latest_date
                FROM desktime_employee_data
                GROUP BY employee_id
            ) latest ON d.employee_id = latest.employee_id AND d.log_date = latest.latest_date
            ORDER BY d.name ASC";
            
    $stmt = $pdo->query($sql);
    $employees = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $employees
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
