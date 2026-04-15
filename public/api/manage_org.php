<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$data = json_decode(file_get_contents('php://input'), true);

try {
    $pdo->beginTransaction();

    $isBatch = isset($data['batch']) && $data['batch'] === true;
    $actions = $isBatch && isset($data['actions']) ? $data['actions'] : [$data];
    $tempIdMap = [];

    foreach ($actions as $actionObj) {
        $action = $actionObj['action'] ?? '';
        $type = $actionObj['type'] ?? ''; // group, team
        $id = $actionObj['id'] ?? null;
        $tempId = $actionObj['temp_id'] ?? null;
        $name = $actionObj['name'] ?? '';
        $groupId = $actionObj['group_id'] ?? null;
        $isVisible = $actionObj['is_visible'] ?? null;
        $managers = $actionObj['managers'] ?? [];

        // Remap group_id if it's a temporary ID we just inserted
        if ($groupId && isset($tempIdMap[$groupId])) {
            $groupId = $tempIdMap[$groupId];
        }

        // Remap target ID if we are updating/deleting/assigning something we just created
        if ($id && isset($tempIdMap[$id])) {
            $id = $tempIdMap[$id];
        } elseif ($tempId && isset($tempIdMap[$tempId])) {
            $id = $tempIdMap[$tempId];
        }

        if ($action === 'create') {
            if ($type === 'group') {
                $stmt = $pdo->prepare("INSERT INTO org_groups (name) VALUES (?)");
                $stmt->execute([$name]);
                $newId = $pdo->lastInsertId();
                if ($tempId)
                    $tempIdMap[$tempId] = $newId;
                log_audit($pdo, 'group', $newId, 'create', "Group '$name' created");
            } else {
                $stmt = $pdo->prepare("INSERT INTO org_teams (group_id, name) VALUES (?, ?)");
                $stmt->execute([$groupId, $name]);
                $newId = $pdo->lastInsertId();
                if ($tempId)
                    $tempIdMap[$tempId] = $newId;
                log_audit($pdo, 'team', $newId, 'create', "Team '$name' created under Group ID $groupId");
            }
        } elseif ($action === 'update') {
            if ($type === 'group') {
                $old = $pdo->prepare("SELECT name FROM org_groups WHERE id = ?");
                $old->execute([$id]);
                $oldName = $old->fetchColumn();

                $stmt = $pdo->prepare("UPDATE org_groups SET name = ? WHERE id = ?");
                $stmt->execute([$name, $id]);

                if ($oldName !== $name) {
                    log_audit($pdo, 'group', $id, 'update', "Name changed from '$oldName' to '$name'");
                } else {
                    log_audit($pdo, 'group', $id, 'update', "Group updated");
                }
            } else {
                $old = $pdo->prepare("SELECT name, group_id FROM org_teams WHERE id = ?");
                $old->execute([$id]);
                $oldData = $old->fetch();

                $stmt = $pdo->prepare("UPDATE org_teams SET name = ?, group_id = ? WHERE id = ?");
                $stmt->execute([$name, $groupId, $id]);

                $details = [];
                if ($oldData['name'] !== $name) $details[] = "Name changed from '{$oldData['name']}' to '$name'";
                if ($oldData['group_id'] != $groupId) $details[] = "Parent Group ID changed from {$oldData['group_id']} to $groupId";

                log_audit($pdo, 'team', $id, 'update', empty($details) ? "Team updated" : implode(", ", $details));
            }
        } elseif ($action === 'toggle_visibility') {
            $table = $type === 'group' ? 'org_groups' : 'org_teams';
            $stmt = $pdo->prepare("UPDATE $table SET is_visible = ? WHERE id = ?");
            $stmt->execute([(int) $isVisible, $id]);
            log_audit($pdo, $type, $id, 'visibility', "Visibility set to " . ($isVisible ? 'ON' : 'OFF'));
        } elseif ($action === 'delete') {
            if ($type === 'group') {
                $teamIds = $pdo->prepare("SELECT id FROM org_teams WHERE group_id = ?");
                $teamIds->execute([$id]);
                $ids = $teamIds->fetchAll(PDO::FETCH_COLUMN);
                if ($ids) {
                    $placeholders = implode(',', array_fill(0, count($ids), '?'));
                    $pdo->prepare("DELETE FROM org_team_managers WHERE target_type = 'team' AND target_id IN ($placeholders)")->execute($ids);
                    $pdo->prepare("DELETE FROM org_team_assignments WHERE team_id IN ($placeholders)")->execute($ids);
                }
                $pdo->prepare("DELETE FROM org_teams WHERE group_id = ?")->execute([$id]);
                $pdo->prepare("DELETE FROM org_team_managers WHERE target_type = 'group' AND target_id = ?")->execute([$id]);
                $pdo->prepare("DELETE FROM org_groups WHERE id = ?")->execute([$id]);
            } else {
                $pdo->prepare("DELETE FROM org_team_managers WHERE target_type = 'team' AND target_id = ?")->execute([$id]);
                $pdo->prepare("DELETE FROM org_team_assignments WHERE team_id = ?")->execute([$id]);
                $pdo->prepare("DELETE FROM org_teams WHERE id = ?")->execute([$id]);
            }
            log_audit($pdo, $type, $id, 'delete', "$type deleted");
        } elseif ($action === 'assign_members') {
            $employeeIds = $actionObj['employee_ids'] ?? [];
            $lunchTime = isset($actionObj['lunch_time']) ? (int)$actionObj['lunch_time'] : null;

            // Clear current assignments
            $pdo->prepare("DELETE FROM org_team_assignments WHERE team_id = ?")->execute([$id]);
            // Insert new assignments
            if (!empty($employeeIds)) {
                $stmt = $pdo->prepare("INSERT INTO org_team_assignments (team_id, employee_id) VALUES (?, ?)");
                foreach ($employeeIds as $empId) {
                    $stmt->execute([$id, $empId]);
                }
            }

            // Update lunch time for the team if provided
            if ($lunchTime !== null) {
                $stmt = $pdo->prepare("UPDATE org_teams SET lunch_time = ? WHERE id = ?");
                $stmt->execute([$lunchTime, $id]);
            }

            log_audit($pdo, 'team', $id, 'assignment', "Batch update: " . count($employeeIds) . " employees assigned" . ($lunchTime !== null ? ", Lunch Time set to $lunchTime mins" : ""));
        }

        // Handle Managers (if provided in update/create)
        if (($action === 'create' || $action === 'update') && !empty($managers)) {
            $targetId = $action === 'create' ? $newId : $id;
            // Clear existing
            $pdo->prepare("DELETE FROM org_team_managers WHERE target_type = ? AND target_id = ?")->execute([$type, $targetId]);
            // Insert new
            $stmt = $pdo->prepare("INSERT INTO org_team_managers (target_type, target_id, manager_name) VALUES (?, ?, ?)");
            foreach ($managers as $manager) {
                $stmt->execute([$type, $targetId, $manager]);
            }
        }
    }

    $pdo->commit();
    echo json_encode(['success' => true]);

} catch (Exception $e) {
    if ($pdo->inTransaction())
        $pdo->rollBack();
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}

function log_audit($pdo, $type, $id, $action, $details)
{
    $stmt = $pdo->prepare("INSERT INTO org_audit_log (target_type, target_id, action, details) VALUES (?, ?, ?, ?)");
    $stmt->execute([$type, $id, $action, $details]);
}
?>