<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'DaylightSaving.php';

try {
    // 1. Fetch all groups
    $groupsStmt = $pdo->query("SELECT * FROM org_groups ORDER BY name ASC");
    $groups = $groupsStmt->fetchAll(PDO::FETCH_ASSOC);

    // 2. Fetch all teams
    $teamsStmt = $pdo->query("SELECT * FROM org_teams ORDER BY name ASC");
    $teamsList = $teamsStmt->fetchAll(PDO::FETCH_ASSOC);

    // 3. Fetch all assigned managers
    $managersStmt = $pdo->query("SELECT * FROM org_team_managers");
    $managers = $managersStmt->fetchAll(PDO::FETCH_ASSOC);

    // 4. Fetch team assignments count
    $countsStmt = $pdo->query("SELECT team_id, COUNT(*) as count FROM org_team_assignments GROUP BY team_id");
    $teamCounts = $countsStmt->fetchAll(PDO::FETCH_KEY_PAIR);

    // 4b. Members with Daylight Saving on, per team (team card badge)
    ensureEmployeeDaylightSavingTable($pdo);
    $dstStmt = $pdo->query("SELECT ota.team_id, COUNT(*) as count
        FROM org_team_assignments ota
        JOIN org_employee_daylight_saving eds ON eds.employee_id = ota.employee_id
        GROUP BY ota.team_id");
    $teamDstCounts = $dstStmt->fetchAll(PDO::FETCH_KEY_PAIR);

    // 5. Structure the data
    $result = [];
    foreach ($groups as $group) {
        $groupData = $group;
        $groupData['type'] = 'group';
        $groupData['managers'] = array_values(array_filter($managers, fn($m) => $m['target_type'] === 'group' && $m['target_id'] == $group['id']));
        $groupData['teams'] = [];

        foreach ($teamsList as $team) {
            if ($team['group_id'] == $group['id']) {
                $teamData = $team;
                $teamData['type'] = 'team';
                $teamData['member_count'] = $teamCounts[$team['id']] ?? 0;
                $teamData['dst_count'] = (int) ($teamDstCounts[$team['id']] ?? 0);
                $teamData['managers'] = array_values(array_filter($managers, fn($m) => $m['target_type'] === 'team' && $m['target_id'] == $team['id']));
                $groupData['teams'][] = $teamData;
            }
        }
        $result[] = $groupData;
    }

    echo json_encode(['success' => true, 'data' => $result]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>