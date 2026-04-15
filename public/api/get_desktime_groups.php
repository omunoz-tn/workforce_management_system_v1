<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    // Fetch distinct DeskTime group names with employee counts (most recent date)
    $stmt = $pdo->query("
        SELECT d.group_name, COUNT(*) as employee_count
        FROM desktime_employee_data d
        WHERE d.group_name IS NOT NULL AND d.group_name != ''
        AND d.log_date = (SELECT MAX(log_date) FROM desktime_employee_data)
        GROUP BY d.group_name
        ORDER BY d.group_name ASC
    ");
    $dtGroups = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Check which names are already imported as org_groups
    $existingStmt = $pdo->query("SELECT name FROM org_groups");
    $existingNames = $existingStmt->fetchAll(PDO::FETCH_COLUMN);

    foreach ($dtGroups as &$g) {
        $g['already_imported'] = in_array($g['group_name'], $existingNames);
    }

    echo json_encode(['success' => true, 'data' => $dtGroups]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>