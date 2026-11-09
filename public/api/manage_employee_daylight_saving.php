<?php
/**
 * manage_employee_daylight_saving.php
 * Employees > Teams > Assign Members > Daylight Saving (see DaylightSaving.php).
 *
 * GET -> every employee with the option on, plus the US change dates around today, so the
 *        page can say when the next hour change happens.
 *
 * Saving goes through manage_org.php (assign_members, key `daylight_saving`), with the
 * rest of the modal, when the user clicks Save All Changes.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'DaylightSaving.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

try {
    $today = date('Y-m-d');
    $year = (int) date('Y');
    $periods = [];
    foreach ([$year - 1, $year, $year + 1] as $y) {
        $periods[] = ['year' => $y] + usDaylightSavingDates($y);
    }

    echo json_encode([
        'success' => true,
        'employee_ids' => array_keys(fetchDaylightSavingEmployees($pdo)),
        'today' => $today,
        // 1 while the US is on standard time (shifts moved +1h), 0 during daylight saving.
        'standard_time_today' => usStandardTimeOffset($today),
        'periods' => $periods,
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
