<?php
/**
 * get_bonus_days.php
 * The day-by-day working behind one employee's Days Employee Worked figure, for the modal
 * the Bonus list opens from that cell.
 *
 * ?employee_id=N&year=&month=
 *
 * Lists every day of the month the employee was rostered for OR tracked time on, whether or
 * not they earned it: the shift, the hours it was worth, the hours DeskTime recorded, and
 * the verdict. A day with neither never appears — a Sunday nobody was rostered for and
 * nobody worked is neither worked nor missed — and neither do days a holiday makes
 * non-working for the team.
 *
 * The rows come from bonusEmployeeDayBreakdown(), which is built on the same SQL the count
 * itself uses (BonusSql.php). Count the worked days here and you get the number the column
 * shows; that is the whole point of the screen.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'BonusSql.php';

session_start();

try {
    if (!isset($_GET['employee_id']) || !is_numeric($_GET['employee_id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'employee_id is required.']);
        exit;
    }
    $employeeId = (int) $_GET['employee_id'];

    $year = isset($_GET['year']) ? (int) $_GET['year'] : (int) date('Y');
    $month = isset($_GET['month']) ? (int) $_GET['month'] : (int) date('n');
    if ($year < 2000 || $year > 2100 || $month < 1 || $month > 12) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid period.']);
        exit;
    }

    // A team-scoped role must not be able to read a day-by-day of somebody outside its
    // teams just by knowing their id.
    if (is_team_restricted()) {
        $teams = current_allowed_teams();
        $allowed = false;
        if (!empty($teams)) {
            $check = $pdo->prepare(
                'SELECT 1 FROM org_team_assignments
                 WHERE employee_id = :employee_id
                   AND team_id IN (' . implode(',', array_map('intval', $teams)) . ')
                 LIMIT 1'
            );
            $check->execute(['employee_id' => $employeeId]);
            $allowed = $check->fetchColumn() !== false;
        }
        if (!$allowed) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'That employee is outside your team access.']);
            exit;
        }
    }

    [$from, $to] = bonusPeriodRange($year, $month);
    $days = bonusEmployeeDayBreakdown($pdo, $employeeId, $from, $to);

    $worked = array_values(array_filter($days, fn($day) => $day['worked']));

    echo json_encode([
        'success' => true,
        'period' => ['year' => $year, 'month' => $month, 'from' => $from, 'to' => $to],
        'worked_day_hours' => bonusWorkedDayHours($pdo),
        'days' => $days,
        'totals' => [
            'scheduled_days' => count($days),
            'worked_days' => count($worked),
            'scheduled_hours' => round(array_sum(array_column($days, 'scheduled_hours')), 2),
            'tracked_hours' => round(array_sum(array_column($days, 'tracked_hours')), 2)
        ]
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
