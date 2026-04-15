<?php
/**
 * get_schedule_board.php
 * Read-only endpoint to fetch employee schedules for a week.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $from = $_GET['from'] ?? null;
    $to = $_GET['to'] ?? null;

    if (!$from || !$to) {
        throw new Exception("From and To dates are required");
    }

    // Query to get all employees and their work shifts for the range
    // We group by employee and date to get a single row per day per person
    // Ordering by name and log_date for easier processing on frontend if needed, 
    // although we'll pivot here.
    $sql = "SELECT 
                d.employee_id, 
                d.name, 
                COALESCE(ot.name, d.group_name) as team_name,
                d.work_starts, 
                d.work_ends, 
                d.log_date
            FROM desktime_employee_data d
            LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
            LEFT JOIN org_teams ot ON ota.team_id = ot.id
            WHERE d.log_date BETWEEN :from AND :to
            ORDER BY d.name ASC, d.log_date ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute(['from' => $from, 'to' => $to]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Pivot data: [employee_id] => [name, team, schedules => [date => {start, end}]]
    $pivot = [];
    foreach ($rows as $row) {
        $id = $row['employee_id'];
        if (!isset($pivot[$id])) {
            $pivot[$id] = [
                'id' => $id,
                'name' => $row['name'],
                'team' => $row['team_name'],
                'schedules' => []
            ];
        }
        $pivot[$id]['schedules'][$row['log_date']] = [
            'start' => $row['work_starts'],
            'end' => $row['work_ends']
        ];
    }

    echo json_encode([
        'success' => true,
        'from' => $from,
        'to' => $to,
        'data' => array_values($pivot)
    ]);

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
