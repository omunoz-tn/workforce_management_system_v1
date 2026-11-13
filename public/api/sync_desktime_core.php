<?php
/**
 * sync_desktime_core.php
 * Core function for synchronizing local database with live data from DeskTime API.
 */
require_once __DIR__ . '/EmployeeRoster.php';
require_once __DIR__ . '/DesktimeApiKeys.php';

/**
 * Folds a syncDeskTime() result into the three numbers every caller logs: how many rows
 * landed, which accounts failed outright, and which rows were lost inside an account that
 * otherwise succeeded.
 *
 * That distinction is the whole point. An account-level failure means the day is wrong and
 * must be retried; a row-level loss means the day is incomplete but retrying the same call
 * would lose the same rows again. Collapsing the two is how a sync that silently dropped
 * employees used to log a clean SUCCESS. This lived as three near-identical copies in
 * sync_desktime_range.php, sync_auto_day.php and (nearly) a fourth in the weekly job; the
 * copies had already drifted, which is what motivated pulling it out.
 */
function syncSummarizeHourResults(array $result)
{
    $hours = 0;
    $errors = [];    // account-level failures: these set the status to 'failure'
    $rowErrors = []; // per-row insert failures: reported, but do not fail the whole day

    foreach ($result['accounts'] as $accName => $acc) {
        $status = $acc['status'] ?? '';

        if ($status === 'success') {
            $hours += $acc['updated_records'] ?? 0;
            if (!empty($acc['errors'])) {
                $n = count($acc['errors']);
                $rowErrors[] = "{$accName}: {$n} fila(s) no guardada(s) [" . substr($acc['errors'][0], 0, 120) . "]";
            }
            continue;
        }

        if ($status !== 'error') {
            continue; // 'skipped': no API key configured for that account
        }

        // 'reason' carries the full cause (cURL error / HTTP code / API message). The raw
        // pieces are only a fallback for an older shape. Note the account name comes from
        // the array key: $acc['account'] is not always set, and reading it there once made
        // every error message come out with a blank account.
        if (!empty($acc['reason'])) {
            $detail = $acc['reason'];
        } elseif (!empty($acc['curl_error'])) {
            $detail = 'cURL: ' . $acc['curl_error'];
        } elseif (isset($acc['http_code'])) {
            $detail = 'HTTP ' . $acc['http_code'];
        } else {
            $detail = 'Unknown';
        }

        $errors[] = "Hours ({$accName}): " . $detail;
    }

    return ['hours' => $hours, 'errors' => $errors, 'row_errors' => $rowErrors];
}

function syncDeskTime($pdo, $env, $date = null)
{
    $results = [
        'success' => true,
        'sync_time' => date('Y-m-d H:i:s'),
        'date' => $date ?: date('Y-m-d'),
        'accounts' => [],
        'skipped_records' => 0
    ];

    // Every configured account (Configuration > Desktime API, else .env).
    $accounts = desktimeAccounts($env);

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

        // The employee master record is maintained alongside the daily rows: this loop is
        // the only place that sees every employee DeskTime still knows about, and the
        // moment it stops seeing one is exactly what `last_seen` has to capture. Prepared
        // once for the whole account rather than per row -- see EmployeeRoster.php.
        ensureOrgEmployeesTable($pdo);
        $rosterStmt = $pdo->prepare(orgEmployeeUpsertSql());

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

                // DeskTime answers with an empty work_starts for anyone it no longer holds a
                // schedule for -- a removed employee, or a date it simply has nothing on file
                // for. $workStarts above turns that into the '00:00:00' sentinel, and the upsert
                // used to write it straight over a schedule that was already correct. Re-syncing
                // a past range after someone was taken out of DeskTime therefore erased their
                // shifts, and with them every absence on those days: the reports prove an
                // employee was expected at work by their schedule, so a day with no schedule
                // cannot hold a no-show (see $absentCondition in get_attendance_details.php and
                // get_absenteeism_details.php).
                //
                // So a schedule is only ever overwritten by another usable schedule -- "usable"
                // being the same test RunRateWindowSql.php applies. Both ends move together:
                // pairing a stored start with an incoming end would invent a window neither
                // source ever reported. Live data (arrival, tracked seconds) still refreshes
                // every time; this guards the schedule alone.
                $incomingShiftIsUsable = "VALUES(work_starts) != '00:00:00'
                          AND VALUES(work_ends) NOT IN ('00:00:00', '23:59:59')
                          AND VALUES(work_ends) > VALUES(work_starts)";

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
                        work_starts = IF($incomingShiftIsUsable, VALUES(work_starts), work_starts),
                        work_ends = IF($incomingShiftIsUsable, VALUES(work_ends), work_ends),
                        log_date = VALUES(log_date),
                        -- Recomputed here rather than taken from VALUES(is_late): the PHP above
                        -- derived that from the incoming work_starts, which is the sentinel on
                        -- exactly the rows this statement keeps the stored schedule for, and a
                        -- late arrival would be filed as on time. Assignments are evaluated left
                        -- to right, so `arrived` and `work_starts` here are the values just set
                        -- above -- keep this line after both.
                        is_late = (arrived IS NOT NULL AND work_starts != '00:00:00' AND TIME(arrived) > work_starts),
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

                // Deliberately after the daily row: an employee whose day failed to store
                // is one this sync cannot vouch for, and widening their window on the
                // strength of a row that was never written would be a lie.
                $rosterStmt->execute([
                    $employeeId,
                    $empData['name'] ?? 'Unknown',
                    $empData['email'] ?? '',
                    $empData['group'] ?? 'Unassigned',
                    $accountName,
                    $logDate,
                    $logDate
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