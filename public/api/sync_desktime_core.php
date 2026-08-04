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
        'accounts' => [],
        'skipped_records' => 0
    ];

    $accounts = [
        'TN' => $env['DESKTIME_API_KEY_TN'] ?? null,
        'BAY' => $env['DESKTIME_API_KEY_BAY'] ?? null
    ];

    $isFirstAccount = true;
    foreach ($accounts as $accountName => $apiKey) {
        if (!$apiKey) {
            $results['accounts'][$accountName] = ['status' => 'skipped', 'account' => $accountName, 'reason' => 'No API key'];
            continue;
        }

        // Space out calls between accounts. Rapid bursts (a range sync fires one request per day,
        // per account) can trip DeskTime's rate limit, which comes back as a non-200 that looks
        // exactly like an auth failure.
        if (!$isFirstAccount) {
            usleep(750000); // 0.75s
        }
        $isFirstAccount = false;

        $baseUrl = "https://desktime.com/api/v2/json/employees";
        $url = $baseUrl . "?apiKey=" . urlencode($apiKey) . ($date ? "&date=" . urlencode($date) : "");

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10); // 10 seconds connect timeout
        curl_setopt($ch, CURLOPT_TIMEOUT, 45); // 45s total: the BAY account routinely takes ~11s

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);

        if ($httpCode !== 200 || $curlError) {
            // Build a human-readable cause. DeskTime returns the real reason in the body, e.g.
            // {"error":{"code":401,"description":"API Key is invalid"}}. Without this, every
            // non-200 collapsed into the same useless "Unknown" in the sync log.
            $apiMessage = '';
            $decoded = json_decode((string) $response, true);
            if (isset($decoded['error']['description'])) {
                $apiMessage = $decoded['error']['description'];
            } elseif (isset($decoded['error']) && is_string($decoded['error'])) {
                $apiMessage = $decoded['error'];
            } elseif (trim((string) $response) !== '') {
                $apiMessage = substr(trim(strip_tags((string) $response)), 0, 150);
            }

            $parts = [];
            if ($curlError) {
                $parts[] = "cURL: " . $curlError;
            }
            $parts[] = "HTTP " . $httpCode;
            if ($apiMessage !== '') {
                $parts[] = $apiMessage;
            }

            $results['accounts'][$accountName] = [
                'status' => 'error',
                'account' => $accountName,
                'http_code' => $httpCode,
                'curl_error' => $curlError,
                'api_message' => $apiMessage,
                'reason' => implode(' - ', $parts)
            ];
            continue;
        }

        $data = json_decode($response, true);
        if (!isset($data['employees']) || !is_array($data['employees'])) {
            $results['accounts'][$accountName] = [
                'status' => 'error',
                'account' => $accountName,
                'http_code' => $httpCode,
                'curl_error' => '',
                'reason' => 'Invalid API response format',
                'preview' => substr((string) $response, 0, 100)
            ];
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
                // `??` only skips null, so DeskTime's empty-string work_starts used to reach
                // MySQL and blow up the row ("Incorrect time value: ''"), silently dropping
                // that employee from the sync.
                $workStarts = !empty($empData['work_starts']) ? $empData['work_starts'] : '00:00:00';
                $workEnds = !empty($empData['work_ends']) ? $empData['work_ends'] : '00:00:00';

                $isLate = 0;
                if ($arrived && $workStarts && $workStarts !== '00:00:00') {
                    $arrivedTimeOnly = date('H:i:s', strtotime($arrived));
                    if (strtotime($arrivedTimeOnly) > strtotime($workStarts)) {
                        $isLate = 1;
                    }
                }

                $logDate = $date ?: date('Y-m-d');

                // DATA INTEGRITY CHECK: Ensure the arrival date matches the target log date
                // This prevents "Friday" data from being saved into "Saturday" during day rollover.
                if ($arrived) {
                    $arrivedDateOnly = date('Y-m-d', strtotime($arrived));
                    if ($arrivedDateOnly !== $logDate) {
                        $results['skipped_records']++;
                        continue;
                    }
                }

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
                    $workEnds,
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
            'account' => $accountName,
            'updated_records' => $count,
            'errors' => $errors,
            'fetched_count' => count($data['employees'])
        ];
    }

    return $results;
}
?>