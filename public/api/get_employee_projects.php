<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

/**
 * get_employee_projects.php
 * Fetches filtered employee project and task data from the database for the report view.
 */

try {
    $fromDate = isset($_GET['from']) ? $_GET['from'] : date('Y-m-d');
    $toDate = isset($_GET['to']) ? $_GET['to'] : date('Y-m-d');

    // Query to fetch project data
    $sql = "SELECT 
                log_date as date,
                employee_name as userName,
                email,
                team_name as team,
                project_title as projectName,
                task_title as taskName,
                duration_seconds as duration
            FROM desktime_project_data
            WHERE log_date BETWEEN :from AND :to
            ORDER BY log_date ASC, employee_name ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        'from' => $fromDate,
        'to' => $toDate
    ]);

    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $data,
        'count' => count($data),
        'from' => $fromDate,
        'to' => $toDate
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
