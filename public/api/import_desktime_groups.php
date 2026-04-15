<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$data = json_decode(file_get_contents('php://input'), true);
// groups: array of { group_name } objects to import
$groupsToImport = $data['groups'] ?? [];
// auto_assign: if true, auto-create a team and assign employees from DeskTime
$autoAssign = $data['auto_assign'] ?? false;

if (empty($groupsToImport)) {
    echo json_encode(['success' => false, 'error' => 'No groups selected']);
    exit;
}

try {
    $pdo->beginTransaction();

    $created = 0;
    $skipped = 0;
    $assigned = 0;

    foreach ($groupsToImport as $group) {
        $name = $group['group_name'];

        // Skip if already exists
        $checkStmt = $pdo->prepare("SELECT id FROM org_groups WHERE name = ?");
        $checkStmt->execute([$name]);
        $existingId = $checkStmt->fetchColumn();

        if ($existingId) {
            $skipped++;
            $groupId = $existingId;
        } else {
            // Create the org_group
            $insertStmt = $pdo->prepare("INSERT INTO org_groups (name, is_visible) VALUES (?, 1)");
            $insertStmt->execute([$name]);
            $groupId = $pdo->lastInsertId();
            $created++;

            // Log it
            $pdo->prepare("INSERT INTO org_audit_log (target_type, target_id, action, details) VALUES ('group', ?, 'import', ?)")
                ->execute([$groupId, "Imported from DeskTime group '{$name}'"]);
        }

        // Auto-assign: create a default team and assign members from DeskTime
        if ($autoAssign && $groupId) {
            // Check if a team with this name already exists under this group
            $checkTeam = $pdo->prepare("SELECT id FROM org_teams WHERE group_id = ? AND name = ?");
            $checkTeam->execute([$groupId, $name]);
            $existingTeam = $checkTeam->fetchColumn();

            if (!$existingTeam) {
                $teamStmt = $pdo->prepare("INSERT INTO org_teams (group_id, name, is_visible) VALUES (?, ?, 1)");
                $teamStmt->execute([$groupId, $name]);
                $teamId = $pdo->lastInsertId();

                $pdo->prepare("INSERT INTO org_audit_log (target_type, target_id, action, details) VALUES ('team', ?, 'import', ?)")
                    ->execute([$teamId, "Auto-created from DeskTime import for group '{$name}'"]);
            } else {
                $teamId = $existingTeam;
            }

            // Get all employees in this DeskTime group (from most recent log date)
            $empStmt = $pdo->prepare("
                SELECT DISTINCT employee_id
                FROM desktime_employee_data
                WHERE group_name = ?
                AND log_date = (SELECT MAX(log_date) FROM desktime_employee_data)
                AND employee_id IS NOT NULL AND employee_id > 0
            ");
            $empStmt->execute([$name]);
            $empIds = $empStmt->fetchAll(PDO::FETCH_COLUMN);

            // Assign employees (ignore duplicates)
            $assignStmt = $pdo->prepare("INSERT IGNORE INTO org_team_assignments (team_id, employee_id) VALUES (?, ?)");
            foreach ($empIds as $empId) {
                $assignStmt->execute([$teamId, $empId]);
                $assigned++;
            }
        }
    }

    $pdo->commit();
    echo json_encode([
        'success' => true,
        'created' => $created,
        'skipped' => $skipped,
        'assigned' => $assigned
    ]);

} catch (Exception $e) {
    if ($pdo->inTransaction())
        $pdo->rollBack();
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>