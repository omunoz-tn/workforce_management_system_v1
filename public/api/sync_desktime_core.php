<?php
/**
 * sync_desktime_core.php
 * Core function for synchronizing local database with live data from DeskTime API.
 */
function syncDeskTime($pdo, $env, $date = null)
{
    $results = [
        'success' => true,
        'sync_time' => date('Y-m-d H:i:s'),
        'date' => $date ?: date('Y-m-d'),
        'accounts' => []
    ];

    $accounts = [
        'TN' => $env['DESKTIME_API_KEY_TN'] ?? null,
        'BAY' => $env['DESKTIME_API_KEY_BAY'] ?? null
    ];

    foreach ($accounts as $accountName => $apiKey) {
        if (!$apiKey) {
            $results['accounts'][$accountName] = ['status' => 'skipped', 'reason' => 'No API key'];
            continue;
        }

        $baseUrl = "https://desktime.com/api/v2/json/employees";
        $url = $baseUrl . "?apiKey=" . urlencode($apiKey) . ($date ? "&date=" . urlencode($date) : "");

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);

        if ($httpCode !== 200) {
            $results['accounts'][$accountName] = [
                'status' => 'error',
                'http_code' => $httpCode,
                'curl_error' => $curlError
            ];
            continue;
        }

        $data = json_decode($response, true);
        if (!isset($data['employees']) || !is_array($data['employees'])) {
            $results['accounts'][$accountName] = ['status' => 'error', 'reason' => 'Invalid API response format', 'preview' => substr($response, 0, 100)];
            continue;
        }

        $employeesToProcess = $data['employees'];
        // Check if the first key is a date (YYYY-MM-DD)
        reset($employeesToProcess);
        $firstKey = key($employeesToProcess);
        if ($firstKey && preg_match('/^\d{4}-\d{2}-\d{2}$/', $firstKey)) {
            $employeesToProcess = $employeesToProcess[$firstKey];
        }

        $count = 0;
        $errors = [];
        foreach ($employeesToProcess as $empKey => $employee) {
            try {
                $empData = is_array($employee) ? $employee : [];
                $employeeId = $empData['id'] ?? $empKey;

                if (!is_numeric($employeeId)) {
                    continue;
                }

                // Map DeskTime fields to our DB fields
                $isOnline = (isset($empData['isOnline']) && $empData['isOnline']) ? 1 : 0;
                $arrived = isset($empData['arrived']) && $empData['arrived'] !== false ? $empData['arrived'] : null;
                $leftTime = isset($empData['left']) && $empData['left'] !== false ? $empData['left'] : null;
                $workStarts = $empData['work_starts'] ?? '00:00:00';

                $isLate = 0;
                if ($arrived && $workStarts && $workStarts !== '00:00:00') {
                    $arrivedTimeOnly = date('H:i:s', strtotime($arrived));
                    if (strtotime($arrivedTimeOnly) > strtotime($workStarts)) {
                        $isLate = 1;
                    }
                }

                $logDate = $date ?: date('Y-m-d');

                $sql = "INSERT INTO desktime_employee_data 
                        (employee_id, name, email, group_name, is_online, arrived, left_time, 
                         productivity, efficiency, work_starts, work_ends, api_account, log_date, is_late,
                         online_time, offline_time, desktime_time, at_work_time, after_work_time, before_work_time, productive_time)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE 
                        is_online = VALUES(is_online),
                        arrived = VALUES(arrived),
                        left_time = VALUES(left_time),
                        productivity = VALUES(productivity),
                        efficiency = VALUES(efficiency),
                        work_starts = VALUES(work_starts),
                        work_ends = VALUES(work_ends),
                        log_date = VALUES(log_date),
                        is_late = VALUES(is_late),
                        online_time = VALUES(online_time),
                        offline_time = VALUES(offline_time),
                        desktime_time = VALUES(desktime_time),
                        at_work_time = VALUES(at_work_time),
                        after_work_time = VALUES(after_work_time),
                        before_work_time = VALUES(before_work_time),
                        productive_time = VALUES(productive_time),
                        updated_at = CURRENT_TIMESTAMP";

                $stmt = $pdo->prepare($sql);
                $stmt->execute([
                    $employeeId,
                    $empData['name'] ?? 'Unknown',
                    $empData['email'] ?? '',
                    $empData['group'] ?? 'Unassigned',
                    $isOnline,
                    $arrived,
                    $leftTime,
                    $empData['productivity'] ?? 0,
                    $empData['efficiency'] ?? 0,
                    $workStarts,
                    $empData['work_ends'] ?? '00:00:00',
                    $accountName,
                    $logDate,
                    $isLate,
                    $empData['onlineTime'] ?? 0,
                    $empData['offlineTime'] ?? 0,
                    $empData['desktimeTime'] ?? 0,
                    $empData['atWorkTime'] ?? 0,
                    $empData['afterWorkTime'] ?? 0,
                    $empData['beforeWorkTime'] ?? 0,
                    $empData['productiveTime'] ?? 0
                ]);
                $count++;
            } catch (Exception $e) {
                $errors[] = "Emp $employeeId: " . $e->getMessage();
            }
        }

        $results['accounts'][$accountName] = [
            'status' => 'success',
            'updated_records' => $count,
            'errors' => $errors,
            'fetched_count' => count($data['employees'])
        ];
    }

    return $results;
}
?>