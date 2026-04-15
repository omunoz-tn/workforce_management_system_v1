<?php
require_once 'db_wfm_config.php';

$teamName = 'WFM';

try {
    // 1. Search by name (case insensitive)
    $stmt = $pdo->query("SELECT DISTINCT COALESCE(ot.name, d.group_name) as name FROM desktime_employee_data d LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id LEFT JOIN org_teams ot ON ota.team_id = ot.id WHERE COALESCE(ot.name, d.group_name) LIKE '%WFM%' OR COALESCE(ot.name, d.group_name) LIKE '%Workforce%'");
    $nameMatches = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 2. Identify teams with ~108 hours scheduled MTD
    $query = "SELECT * FROM (
                SELECT 
                    COALESCE(ot.name, d.group_name) as display_name,
                    SUM(CASE WHEN d.work_ends > d.work_starts AND d.work_starts != '00:00:00' AND d.work_ends != '00:00:00' 
                        THEN (TIME_TO_SEC(d.work_ends) - TIME_TO_SEC(d.work_starts)) / 3600 
                        ELSE 0 END) as scheduled_hours
                FROM desktime_employee_data d
                LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
                LEFT JOIN org_teams ot ON ota.team_id = ot.id
                WHERE d.log_date BETWEEN DATE_FORMAT(CURDATE(), '%Y-%m-01') AND CURDATE()
                GROUP BY display_name
              ) as t
              ORDER BY scheduled_hours DESC";
    $stmt = $pdo->query($query);
    $allTeamsHours = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'nameMatches' => $nameMatches,
        'allTeamsHours' => $allTeamsHours
    ], JSON_PRETTY_PRINT);

} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
?>
