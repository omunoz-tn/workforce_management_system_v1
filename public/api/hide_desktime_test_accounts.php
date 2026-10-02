<?php
/**
 * hide_desktime_test_accounts.php
 * One-off: parks the dormant DeskTime accounts of the "IT" group in a hidden team so they
 * stop being counted by the reports.
 *
 * The reports label each row `COALESCE(ot.name, d.group_name)`, so an employee with no
 * org team assignment falls back to their raw DeskTime group name. The DeskTime group
 * "IT" is spelled exactly like the org team "IT" (#68), so 20 unassigned accounts were
 * being merged into that team's figures. Nineteen of them are test users and leftovers
 * that never registered a single arrival and never tracked a second, yet still carried a
 * shift in DeskTime — which made them read as absent every scheduled day and pushed IT's
 * year-to-date absence rate to 85% against a real 1.07%.
 *
 * Assigning them to a team with is_visible = 0 is what every report already honours
 * (`AND (ot.is_visible IS NULL OR ot.is_visible = 1)`); the NULL branch is precisely the
 * loophole an unassigned employee slips through. Doing it this way rather than deleting
 * rows keeps the raw history intact and leaves the change reversible from
 * Configuración > Teams, where the hidden group and team are listed with an eye toggle.
 *
 * Carlos Reyes (633230) is deliberately NOT included: he is a real ex-employee with 26
 * arrivals and 222 tracked hours, so his 11 absences are genuine data.
 *
 * Safe to re-run: it reuses the group/team if they already exist and skips employees that
 * already have any assignment.
 *
 * Run: php public/api/hide_desktime_test_accounts.php   (or open it in the browser)
 */
require_once __DIR__ . '/db_wfm_config.php';

const EXCLUDED_GROUP_NAME = 'EXCLUDED';
const EXCLUDED_TEAM_NAME = 'Test & Inactive Accounts';
const SOURCE_DESKTIME_GROUP = 'IT';

$isCli = PHP_SAPI === 'cli';
if (!$isCli) {
    header('Content-Type: application/json');
}

/** Dormant = no org team, in the source DeskTime group, never arrived, never tracked. */
function findDormantAccounts(PDO $pdo, string $desktimeGroup): array
{
    $stmt = $pdo->prepare("
        SELECT d.employee_id, MAX(d.name) AS name
        FROM desktime_employee_data d
        LEFT JOIN org_team_assignments ota ON d.employee_id = ota.employee_id
        WHERE d.group_name = ? AND ota.employee_id IS NULL
        GROUP BY d.employee_id
        HAVING SUM(d.arrived IS NOT NULL) = 0
           AND COALESCE(SUM(d.desktime_time), 0) = 0
        ORDER BY name
    ");
    $stmt->execute([$desktimeGroup]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

function findOrCreateHiddenGroup(PDO $pdo): int
{
    $stmt = $pdo->prepare("SELECT id FROM org_groups WHERE name = ?");
    $stmt->execute([EXCLUDED_GROUP_NAME]);
    $id = $stmt->fetchColumn();
    if ($id) {
        return (int) $id;
    }

    $pdo->prepare("INSERT INTO org_groups (name, is_visible) VALUES (?, 0)")->execute([EXCLUDED_GROUP_NAME]);
    return (int) $pdo->lastInsertId();
}

function findOrCreateHiddenTeam(PDO $pdo, int $groupId): int
{
    $stmt = $pdo->prepare("SELECT id FROM org_teams WHERE group_id = ? AND name = ?");
    $stmt->execute([$groupId, EXCLUDED_TEAM_NAME]);
    $id = $stmt->fetchColumn();
    if ($id) {
        return (int) $id;
    }

    $pdo->prepare("INSERT INTO org_teams (group_id, name, is_visible) VALUES (?, ?, 0)")
        ->execute([$groupId, EXCLUDED_TEAM_NAME]);
    return (int) $pdo->lastInsertId();
}

function logAudit(PDO $pdo, string $type, int $id, string $action, string $details): void
{
    $pdo->prepare("INSERT INTO org_audit_log (target_type, target_id, action, details) VALUES (?, ?, ?, ?)")
        ->execute([$type, $id, $action, $details]);
}

try {
    $accounts = findDormantAccounts($pdo, SOURCE_DESKTIME_GROUP);

    if (count($accounts) === 0) {
        $out = ['success' => true, 'message' => 'Nothing to do — no dormant unassigned accounts found.', 'assigned' => 0];
        echo $isCli ? print_r($out, true) : json_encode($out, JSON_PRETTY_PRINT);
        exit;
    }

    $pdo->beginTransaction();

    $groupId = findOrCreateHiddenGroup($pdo);
    $teamId = findOrCreateHiddenTeam($pdo, $groupId);

    $insert = $pdo->prepare("INSERT IGNORE INTO org_team_assignments (team_id, employee_id) VALUES (?, ?)");
    $assigned = [];
    foreach ($accounts as $account) {
        $insert->execute([$teamId, $account['employee_id']]);
        $assigned[] = $account['name'] . ' (' . $account['employee_id'] . ')';
    }

    logAudit(
        $pdo,
        'team',
        $teamId,
        'assign',
        sprintf(
            'Parked %d dormant DeskTime "%s" accounts (no arrivals, no tracked time) in the hidden team "%s". They were being counted under the org team of the same name. Members: %s',
            count($assigned),
            SOURCE_DESKTIME_GROUP,
            EXCLUDED_TEAM_NAME,
            implode('; ', $assigned)
        )
    );

    $pdo->commit();

    $out = [
        'success' => true,
        'group_id' => $groupId,
        'team_id' => $teamId,
        'assigned' => count($assigned),
        'members' => $assigned,
    ];
    echo $isCli ? print_r($out, true) : json_encode($out, JSON_PRETTY_PRINT);
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if (!$isCli) {
        http_response_code(500);
    }
    $out = ['success' => false, 'error' => $e->getMessage()];
    echo $isCli ? print_r($out, true) : json_encode($out, JSON_PRETTY_PRINT);
}
