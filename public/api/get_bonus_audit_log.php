<?php
/**
 * get_bonus_audit_log.php
 * What HR > History reads: the Bonus module's change log, newest first.
 *
 * ?year=&month=&action=&search=&limit=&offset=
 *
 * Every filter is optional. `year`/`month` narrow to the period a change was ABOUT, not the
 * date it was made — those differ constantly, since August's list keeps being corrected in
 * September. `search` matches the employee or the user, accent- and case-insensitively via
 * the column collation.
 *
 * Read-only by design. There is no endpoint to edit or delete an entry, and there should
 * not be: a log that can be rewritten answers nothing.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'BonusAudit.php';

session_start();

try {
    ensureBonusAuditTable($pdo);

    $where = [];
    $params = [];

    if (isset($_GET['year']) && $_GET['year'] !== '' && is_numeric($_GET['year'])) {
        $where[] = 'period_year = :year';
        $params['year'] = (int) $_GET['year'];
    }
    if (isset($_GET['month']) && $_GET['month'] !== '' && is_numeric($_GET['month'])) {
        $where[] = 'period_month = :month';
        $params['month'] = (int) $_GET['month'];
    }
    if (isset($_GET['action']) && $_GET['action'] !== '') {
        $where[] = 'action = :action';
        $params['action'] = (string) $_GET['action'];
    }
    if (isset($_GET['search']) && trim((string) $_GET['search']) !== '') {
        $where[] = '(employee_name LIKE :search OR user_name LIKE :search OR field LIKE :search)';
        $params['search'] = '%' . trim((string) $_GET['search']) . '%';
    }

    // A team-scoped role sees only entries about employees on its teams. Entries with no
    // employee at all — a settings change — are platform-wide, so they stay admin-only.
    if (is_team_restricted()) {
        $teams = current_allowed_teams();
        $where[] = empty($teams)
            ? '1=0'
            : 'employee_id IN (SELECT employee_id FROM org_team_assignments WHERE team_id IN ('
                . implode(',', array_map('intval', $teams)) . '))';
    }

    $whereSql = empty($where) ? '' : 'WHERE ' . implode(' AND ', $where);

    $limit = isset($_GET['limit']) ? max(1, min(500, (int) $_GET['limit'])) : 100;
    $offset = isset($_GET['offset']) ? max(0, (int) $_GET['offset']) : 0;

    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM org_bonus_audit_log $whereSql");
    $countStmt->execute($params);
    $total = (int) $countStmt->fetchColumn();

    $stmt = $pdo->prepare(
        "SELECT id, bonus_type, period_year, period_month, bonus_row_id, employee_id,
                employee_name, action, field, old_value, new_value, user_name, created_at
         FROM org_bonus_audit_log
         $whereSql
         ORDER BY created_at DESC, id DESC
         LIMIT $limit OFFSET $offset"
    );
    $stmt->execute($params);

    echo json_encode([
        'success' => true,
        'total' => $total,
        'limit' => $limit,
        'offset' => $offset,
        'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
