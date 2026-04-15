<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'sync_desktime_core.php';

// Set long execution time as range sync can take while
set_time_limit(300);

try {
    $from = $_GET['from'] ?? null;
    $to = $_GET['to'] ?? null;
    $stepDate = $_GET['date'] ?? null;

    if (!$from || !$to) {
        throw new Exception("From and To dates are required");
    }

    // If stepDate is provided, we process just that single day (for progress bar implementation)
    if ($stepDate) {
        $result = syncDeskTime($pdo, $env, $stepDate);
        
        $hoursUpdated = 0;
        $errors = [];
        foreach ($result['accounts'] as $accName => $acc) {
            if ($acc['status'] === 'success') {
                $hoursUpdated += $acc['updated_records'];
            } else if ($acc['status'] === 'error') {
                $curlErr = isset($acc['curl_error']) ? $acc['curl_error'] : '';
                $reasonErr = isset($acc['reason']) ? $acc['reason'] : 'Unknown';
                $errDetail = $curlErr ? $curlErr : $reasonErr;
                $errors[] = "Hours ({$accName}): " . $errDetail;
            }
        }
        $errorMsg = empty($errors) ? '' : implode(' | ', $errors);

        $logSql = "INSERT INTO desktime_sync_log (sync_date, status, hours_updated, projects_updated, error_message, sync_type) VALUES (?, ?, ?, ?, ?, 'manual')";
        $stmt = $pdo->prepare($logSql);
        $stmt->execute([$stepDate, empty($errors) ? 'success' : 'failure', $hoursUpdated, 0, $errorMsg]);

        echo json_encode([
            'success' => true,
            'date' => $stepDate,
            'result' => $result
        ]);
        exit;
    }

    // Otherwise, internal loop (less efficient for progress bar but works for direct calls)
    $startDate = new DateTime($from);
    $endDate = new DateTime($to);
    $rangeResults = [];

    for ($date = $startDate; $date <= $endDate; $date->modify('+1 day')) {
        $currentDate = $date->format('Y-m-d');
        $rangeResults[$currentDate] = syncDeskTime($pdo, $env, $currentDate);
    }

    echo json_encode([
        'success' => true,
        'from' => $from,
        'to' => $to,
        'results' => $rangeResults
    ]);

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
