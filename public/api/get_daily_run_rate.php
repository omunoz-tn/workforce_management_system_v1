<?php
// Disable error output for clean JSON
ini_set('display_errors', 0);
error_reporting(0);

header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'RunRateWindowSql.php';

try {
    session_start();
    $teamFilter = team_filter_sql('ota.team_id');

    $from = isset($_GET['from']) ? $_GET['from'] : date('Y-m-01');
    $to = isset($_GET['to']) ? $_GET['to'] : date('Y-m-d');
    $team = isset($_GET['team']) ? $_GET['team'] : null;

    $params = ['from' => $from, 'to' => $to];

    $teamCondition = '';
    if ($team) {
        $teamCondition = " AND (ot.name = :team OR d.group_name = :team)";
        $params['team'] = $team;
    }

    // Shared with the projection's compliance history, see RunRateWindowSql.php.
    $query = rrDailyRowsSql($teamFilter . $teamCondition) . "
                ORDER BY d.log_date ASC, d.name ASC";

    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $data,
        'count' => count($data)
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>
