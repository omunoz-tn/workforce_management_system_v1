<?php
/**
 * sync_auto_background.php
 * Automated background sync for Core Hours and Projects.
 * Triggers once per day for "Yesterday's" data.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'sync_desktime_core.php';

// Long timeout to avoid failures
set_time_limit(300);

try {
    // 0. Ensure migration log table exists
    $pdo->exec("CREATE TABLE IF NOT EXISTS desktime_sync_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sync_date DATE NOT NULL,
        status ENUM('success', 'failure', 'skipped') NOT NULL,
        hours_updated INT DEFAULT 0,
        projects_updated INT DEFAULT 0,
        error_message TEXT,
        sync_type ENUM('manual', 'automatic') DEFAULT 'automatic',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (sync_date)
    )");

    // Ensure sync_type column exists if table was already created
    $stmt = $pdo->query("SHOW COLUMNS FROM desktime_sync_log LIKE 'sync_type'");
    if (!$stmt->fetch()) {
        $pdo->exec("ALTER TABLE desktime_sync_log ADD COLUMN sync_type ENUM('manual', 'automatic') DEFAULT 'automatic' AFTER error_message");
    }

    // 1. Determine "Yesterday" (the date we are syncing)
    $yesterday = date('Y-m-d', strtotime('-1 day'));
    $today = date('Y-m-d');

    // 2. Check if we already successfully synced "Yesterday" TODAY with PROJECT data
    // This prevents skipping if a manual/partial sync (like hours-only) happened earlier.
    $checkSql = "SELECT id FROM desktime_sync_log 
                 WHERE sync_date = ? AND status = 'success' AND DATE(created_at) = ? 
                 AND projects_updated > 0";
    $stmt = $pdo->prepare($checkSql);
    $stmt->execute([$yesterday, $today]);
    if ($stmt->fetch()) {
        echo json_encode([
            'success' => true,
            'status' => 'skipped',
            'message' => 'Yesterday was already synced today.',
            'date' => $yesterday
        ]);
        exit;
    }

    $hoursCount = 0;
    $projectsCount = 0;
    $errors = [];

    // 3. Sync Core Hours (Save Hours)
    $hoursResult = syncDeskTime($pdo, $env, $yesterday);
    $rowErrors = []; // per-row insert failures: reported, but do not fail the whole day
    foreach ($hoursResult['accounts'] as $accName => $acc) {
        if ($acc['status'] === 'success') {
            $hoursCount += $acc['updated_records'];
            // Previously discarded, which let a sync that dropped employees log a clean SUCCESS.
            if (!empty($acc['errors'])) {
                $n = count($acc['errors']);
                $rowErrors[] = "{$accName}: {$n} fila(s) no guardada(s) [" . substr($acc['errors'][0], 0, 120) . "]";
            }
        } else if ($acc['status'] === 'error') {
            // Was: "{$acc['account']}" (that key never existed here, so the name came out blank)
            // plus `?? ` which does not skip an empty-string curl_error, blanking the detail too.
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

    // 4. Sync Project Data (Employee Project Report)
    // Using optimized single-day logic
    $accounts = [
        'TN' => $env['DESKTIME_API_KEY_TN'] ?? null,
        'BAY' => $env['DESKTIME_API_KEY_BAY'] ?? null
    ];

    foreach ($accounts as $accName => $apiKey) {
        if (!$apiKey) continue;

        // Fetch employees specifically for yesterday
        $empUrl = "https://desktime.com/api/v2/json/employees?apiKey=" . urlencode($apiKey) . "&date=" . urlencode($yesterday);
        $ch = curl_init($empUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        $empRes = curl_exec($ch);
        curl_close($ch);
        $empResArr = json_decode($empRes, true);
        if (!isset($empResArr['employees'])) continue;
        
        $employeesToProcess = $empResArr['employees'];
        // Robustly find the employee list (handles date-keyed or direct list)
        reset($employeesToProcess);
        $firstKey = key($employeesToProcess);
        if ($firstKey && preg_match('/^\d{4}-\d{2}-\d{2}$/', $firstKey)) {
            $employeesToProcess = $employeesToProcess[$firstKey];
        }

        foreach ($employeesToProcess as $empKey => $emp) {
            $eData = is_array($emp) ? $emp : [];
            $realEmpId = $eData['id'] ?? $empKey;
            
            if (!is_numeric($realEmpId)) continue;
            
            $projUrl = "https://desktime.com/api/v2/json/employee/projects?apiKey=" . urlencode($apiKey) . "&id=" . urlencode($realEmpId) . "&date=" . urlencode($yesterday);
            $chP = curl_init($projUrl);
            curl_setopt($chP, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($chP, CURLOPT_SSL_VERIFYPEER, false);
            $projRes = curl_exec($chP);
            curl_close($chP);
            
            $projData = json_decode($projRes, true);
            if (isset($projData['projects']) && is_array($projData['projects'])) {
                foreach ($projData['projects'] as $proj) {
                    $sql = "INSERT INTO desktime_project_data 
                            (employee_id, employee_name, email, team_name, project_id, project_title, task_id, task_title, duration_seconds, log_date, api_account)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE 
                            duration_seconds = VALUES(duration_seconds),
                            employee_name = VALUES(employee_name),
                            team_name = VALUES(team_name),
                            project_title = VALUES(project_title),
                            task_title = VALUES(task_title)";
                    
                    $stmt = $pdo->prepare($sql);
                    $stmt->execute([
                        $realEmpId, 
                        $projData['name'] ?? ($eData['name'] ?? 'Unknown'), 
                        $projData['email'] ?? ($eData['email'] ?? ''),
                        $projData['group'] ?? ($eData['group'] ?? 'Unassigned'), 
                        $proj['project_id'] ?? 0,
                        $proj['project_title'] ?? '', 
                        $proj['task_id'] ?? 0,
                        $proj['task_title'] ?? '', 
                        $proj['duration'] ?? 0,
                        $yesterday, 
                        $accName
                    ]);
                    $projectsCount++;
                }
            }
        }
    }

    // 5. Log completion
    // Status was hardcoded to 'success' here, so an account-level failure was recorded as a
    // successful sync. Row-level losses are reported in the message without failing the day.
    $allMessages = array_merge($errors, $rowErrors);
    $logSql = "INSERT INTO desktime_sync_log (sync_date, status, hours_updated, projects_updated, error_message, sync_type) VALUES (?, ?, ?, ?, ?, 'automatic')";
    $stmt = $pdo->prepare($logSql);
    $stmt->execute([
        $yesterday,
        empty($errors) ? 'success' : 'failure',
        $hoursCount,
        $projectsCount,
        implode(' | ', $allMessages)
    ]);

    echo json_encode([
        'success' => true,
        'status' => 'completed',
        'date' => $yesterday,
        'hours_synced' => $hoursCount,
        'projects_synced' => $projectsCount,
        'errors' => $errors,
        'row_errors' => $rowErrors
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
