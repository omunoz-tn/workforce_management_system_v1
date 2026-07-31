<?php
/**
 * manage_schedule_forecast.php
 * Manages manual per-employee forecast source overrides for the Schedule Board.
 * An override pins a specific historical week as the source pattern to apply
 * (per weekday) to future weeks up to a chosen end week, taking priority over
 * the automatic weekday-pattern forecast in get_schedule_board.php.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

function weekMondayOf($dateStr)
{
    $d = new DateTime($dateStr);
    $weekday = (int) $d->format('N'); // 1 = Monday ... 7 = Sunday
    $d->modify('-' . ($weekday - 1) . ' days');
    return $d->format('Y-m-d');
}

$method = $_SERVER['REQUEST_METHOD'];
$currentMonday = weekMondayOf(date('Y-m-d'));

// A pattern maps ISO weekday (1=Mon..7=Sun) to either "OFF" or "HH:MM:SS|HH:MM:SS".
function validatePattern($pattern)
{
    if (!is_array($pattern)) {
        throw new Exception('pattern must be an object');
    }
    $clean = [];
    for ($weekday = 1; $weekday <= 7; $weekday++) {
        $value = $pattern[$weekday] ?? $pattern[(string) $weekday] ?? 'OFF';
        if ($value === 'OFF' || $value === null) {
            $clean[$weekday] = 'OFF';
            continue;
        }
        if (!preg_match('/^\d{2}:\d{2}:\d{2}\|\d{2}:\d{2}:\d{2}$/', $value)) {
            throw new Exception("Invalid pattern value for weekday $weekday");
        }
        [$start, $end] = explode('|', $value);
        if ($end <= $start) {
            throw new Exception("End time must be after start time for weekday $weekday");
        }
        $clean[$weekday] = $value;
    }
    return $clean;
}

if ($method === 'GET') {
    try {
        $cleanup = $pdo->prepare("DELETE FROM org_schedule_forecast_overrides WHERE target_end_week_start < :currentMonday");
        $cleanup->execute(['currentMonday' => $currentMonday]);

        $stmt = $pdo->query("
            SELECT id, employee_id, employee_name, source_week_start, target_end_week_start, pattern, created_at
            FROM org_schedule_forecast_overrides
            ORDER BY created_at DESC
        ");
        $overrides = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($overrides as &$row) {
            $row['pattern'] = $row['pattern'] ? json_decode($row['pattern'], true) : null;
        }
        unset($row);

        echo json_encode(['success' => true, 'overrides' => $overrides]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $employeeId = isset($data['employee_id']) ? (int) $data['employee_id'] : null;
    $employeeName = $data['employee_name'] ?? null;
    $sourceWeekStart = $data['source_week_start'] ?? null;
    $targetEndWeekStart = $data['target_end_week_start'] ?? null;
    $pattern = $data['pattern'] ?? null;

    if (!$employeeId || !$employeeName || !$sourceWeekStart || !$targetEndWeekStart || !$pattern) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'employee_id, employee_name, source_week_start, target_end_week_start and pattern are required']);
        exit;
    }

    try {
        if (weekMondayOf($sourceWeekStart) !== $sourceWeekStart || weekMondayOf($targetEndWeekStart) !== $targetEndWeekStart) {
            throw new Exception('source_week_start and target_end_week_start must both be Mondays');
        }
        if ($targetEndWeekStart < $currentMonday) {
            throw new Exception('target_end_week_start cannot be entirely in the past');
        }
        if ($sourceWeekStart > $currentMonday) {
            throw new Exception('source_week_start cannot be a future week');
        }
        $cleanPattern = validatePattern($pattern);

        $stmt = $pdo->prepare("
            INSERT INTO org_schedule_forecast_overrides (employee_id, employee_name, source_week_start, target_end_week_start, pattern)
            VALUES (:employee_id, :employee_name, :source_week_start, :target_end_week_start, :pattern)
            ON DUPLICATE KEY UPDATE
                employee_name = VALUES(employee_name),
                source_week_start = VALUES(source_week_start),
                target_end_week_start = VALUES(target_end_week_start),
                pattern = VALUES(pattern)
        ");
        $stmt->execute([
            'employee_id' => $employeeId,
            'employee_name' => $employeeName,
            'source_week_start' => $sourceWeekStart,
            'target_end_week_start' => $targetEndWeekStart,
            'pattern' => json_encode($cleanPattern)
        ]);

        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'DELETE') {
    $employeeId = isset($_GET['employee_id']) ? (int) $_GET['employee_id'] : null;

    if (!$employeeId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'employee_id is required']);
        exit;
    }

    try {
        $stmt = $pdo->prepare("DELETE FROM org_schedule_forecast_overrides WHERE employee_id = ?");
        $stmt->execute([$employeeId]);

        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
?>
