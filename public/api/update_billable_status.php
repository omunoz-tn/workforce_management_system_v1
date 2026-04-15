<?php
// Disable error output for clean JSON
ini_set('display_errors', 0);
error_reporting(0);

header('Content-Type: application/json');
require_once 'db_wfm_config.php';

// Post request handling
$input = file_get_contents("php://input");
$data = json_decode($input, true);

if (!isset($data['employee_ids']) || !isset($data['is_billable'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing required fields']);
    exit;
}

$employeeIds = $data['employee_ids'];
$isBillable = $data['is_billable'] ? 1 : 0;

if (!is_array($employeeIds) || empty($employeeIds)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Employee IDs must be a non-empty array']);
    exit;
}

try {
    // Update all occurrences of these employees
    $placeholders = implode(',', array_fill(0, count($employeeIds), '?'));
    $sql = "UPDATE desktime_employee_data SET is_billable = ? WHERE employee_id IN ($placeholders)";
    
    $params = array_merge([$isBillable], $employeeIds);
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    
    echo json_encode(['success' => true, 'updated_count' => $stmt->rowCount()]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
