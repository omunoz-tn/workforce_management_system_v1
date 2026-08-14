<?php
/**
 * manage_team_holiday_types.php
 * Per-team holiday type (Employees > Teams > Assign Members > Holidays).
 *
 * org_holidays.holiday_type stays the organization-wide DEFAULT, set in the Holidays
 * sub-menu. A team only stores rows for holidays where it disagrees with that default,
 * so a holiday created later applies everywhere without fanning out a row per team.
 *
 *   effective type = COALESCE(org_team_holiday_types.holiday_type, org_holidays.holiday_type)
 *
 * A non_working effective type removes that team's day from the Run Rate
 * (get_daily_run_rate.php, get_dashboard_stats.php) and forces OFF in the Schedule
 * Board forecast (get_schedule_board.php) — for that team only.
 *
 * The Custom type (stored as the enum value `campaign_defined`) can also carry a time
 * range. On that holiday the range is discounted from the team's SCHEDULED hours only —
 * the hours DeskTime tracked are never modified.
 *
 * GET  ?team_id=N -> every holiday with its default, override, effective type and range
 * POST { team_id, types: { holiday_id: type | {type, from, to}, ... } }
 *      -> replaces that team's override set
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'TeamHolidayTypes.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // team_id 0 is legitimate: the Assign Members modal opens on a team that has not
    // been saved yet, which has no overrides, so every holiday comes back on its default.
    if (!isset($_GET['team_id']) || !is_numeric($_GET['team_id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'team_id is required']);
        exit;
    }
    $teamId = (int) $_GET['team_id'];

    try {
        // Deliberately unfiltered: POST replaces a team's whole override set, so the
        // client has to hold every holiday in its draft. Narrowing this by year would
        // make saving from a year-filtered modal wipe the other years' overrides.
        // The year picker in the modal filters the returned list client-side.
        $stmt = $pdo->prepare(
            "SELECT h.id, h.name, h.holiday_date, h.country_code, h.description,
                    h.holiday_type AS default_type,
                    tht.holiday_type AS team_type,
                    COALESCE(tht.holiday_type, h.holiday_type) AS effective_type,
                    tht.exclude_from,
                    tht.exclude_to
             FROM org_holidays h
             LEFT JOIN org_team_holiday_types tht
                    ON tht.holiday_id = h.id AND tht.team_id = :team_id
             ORDER BY h.holiday_date"
        );
        $stmt->execute(['team_id' => $teamId]);

        echo json_encode([
            'success' => true,
            'holidays' => $stmt->fetchAll(PDO::FETCH_ASSOC)
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $teamId = isset($data['team_id']) ? (int) $data['team_id'] : null;
    $types = $data['types'] ?? [];

    if (!$teamId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'team_id is required']);
        exit;
    }
    if (!is_array($types)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'types must be an object']);
        exit;
    }

    try {
        validateTeamHolidayTypes($types);
    } catch (InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        exit;
    }

    try {
        $pdo->beginTransaction();
        saveTeamHolidayTypes($pdo, $teamId, $types);
        $pdo->commit();
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
?>
