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
        $errors = [];    // account-level failures: these set the status to 'failure'
        $rowErrors = []; // per-row insert failures: reported, but do not fail the whole day
        foreach ($result['accounts'] as $accName => $acc) {
            if ($acc['status'] === 'success') {
                $hoursUpdated += $acc['updated_records'];
                // These were collected by the core and then discarded, so a sync that
                // silently dropped employees still logged a clean SUCCESS.
                if (!empty($acc['errors'])) {
                    $n = count($acc['errors']);
                    $rowErrors[] = "{$accName}: {$n} fila(s) no guardada(s) [" . substr($acc['errors'][0], 0, 120) . "]";
                }
            } else if ($acc['status'] === 'error') {
                // 'reason' now carries the full cause (cURL error / HTTP code / API message).
                // Fall back to the raw pieces only if an older shape reaches us.
                $errDetail = '';
                if (!empty($acc['reason'])) {
                    $errDetail = $acc['reason'];
                } elseif (!empty($acc['curl_error'])) {
                    $errDetail = "cURL: " . $acc['curl_error'];
                } elseif (isset($acc['http_code'])) {
                    $errDetail = "HTTP " . $acc['http_code'];
                } else {
                    $errDetail = 'Unknown';
                }
                $errors[] = "Hours ({$accName}): " . $errDetail;
            }
        }
        // Status reflects account-level failures only; row losses are surfaced in the message
        // so a partial sync never shows up as a clean SUCCESS.
        $allMessages = array_merge($errors, $rowErrors);
        $errorMsg = empty($allMessages) ? '' : implode(' | ', $allMessages);

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
