<?php
/**
 * get_team_members.php
 * Employees assigned to a team (org_team_assignments).
 *
 * GET team_id
 *   data     the member ids (what Teams.jsx reads)
 *   members  the same members with their name, for pickers that must list everyone on the
 *            team, including people with no DeskTime rows in the current month (all their
 *            days excluded, or gone from DeskTime) who still get a projected shift.
 *            last_seen is their latest DeskTime day (null if none), so a page can say
 *            why someone is missing from today's DeskTime list.
 */
require_once 'db_wfm_config.php';

$teamId = $_GET['team_id'] ?? null;

try {
    if (!$teamId)
        throw new Exception("Team ID required");

    $stmt = $pdo->prepare("
        SELECT ota.employee_id, oe.name,
               (SELECT MAX(d.log_date) FROM desktime_employee_data d
                 WHERE d.employee_id = ota.employee_id) AS last_seen
        FROM org_team_assignments ota
        LEFT JOIN org_employees oe ON oe.employee_id = ota.employee_id
        WHERE ota.team_id = ?
    ");
    $stmt->execute([$teamId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $members = array_map(function ($row) {
        return [
            'employee_id' => (int) $row['employee_id'],
            'name' => $row['name'] !== null && $row['name'] !== '' ? $row['name'] : 'Employee ' . $row['employee_id'],
            'last_seen' => $row['last_seen'],
        ];
    }, $rows);

    echo json_encode([
        'success' => true,
        'data' => array_column($rows, 'employee_id'),
        'members' => $members,
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
