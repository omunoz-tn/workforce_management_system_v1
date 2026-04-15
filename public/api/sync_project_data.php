<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

/**
 * sync_project_data.php
 * Extracts project and task information from DeskTime API for all employees and stores it in the database.
 */

try {
    // Increase execution time as project sync can be slow (one request per employee)
    set_time_limit(300);

    // We now focus on smaller buckets (typically 1 day) to avoid timeouts
    $fromDate = isset($_GET['from']) ? $_GET['from'] : date('Y-m-d');
    $toDate = isset($_GET['to']) ? $_GET['to'] : $fromDate;

    $accounts = [
        'TN' => $env['DESKTIME_API_KEY_TN'] ?? null,
        'BAY' => $env['DESKTIME_API_KEY_BAY'] ?? null
    ];

    $totalProcessed = 0;
    $syncLog = [];

    foreach ($accounts as $accName => $apiKey) {
        if (!$apiKey) continue;

        // 1. Fetch current date range
        $currentDate = $fromDate;
        while (strtotime($currentDate) <= strtotime($toDate)) {
            
            // 2. Fetch employees for THIS specific day
            $empUrl = "https://desktime.com/api/v2/json/employees?apiKey=" . urlencode($apiKey) . "&date=" . urlencode($currentDate);
            
            $ch = curl_init($empUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            $empRes = curl_exec($ch);
            curl_close($ch);
            
            $empResArr = json_decode($empRes, true);

            if (!isset($empResArr['employees'])) {
                $currentDate = date('Y-m-d', strtotime($currentDate . ' +1 day'));
                continue;
            }

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

                $projUrl = "https://desktime.com/api/v2/json/employee/projects?apiKey=" . urlencode($apiKey) . "&id=" . urlencode($realEmpId) . "&date=" . urlencode($currentDate);
                
                $chP = curl_init($projUrl);
                curl_setopt($chP, CURLOPT_RETURNTRANSFER, true);
                curl_setopt($chP, CURLOPT_SSL_VERIFYPEER, false);
                $projResArr = curl_exec($chP);
                curl_close($chP);
                
                if (!$projResArr) continue; 
                
                $projData = json_decode($projResArr, true);

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
                            $currentDate,
                            $accName
                        ]);
                        $totalProcessed++;
                    }
                }
            }
            // Log success for this specific date in the range
            $logSql = "INSERT INTO desktime_sync_log (sync_date, status, hours_synced, projects_synced, sync_type) VALUES (?, 'success', 0, ?, 'manual')";
            $stmt = $pdo->prepare($logSql);
            $stmt->execute([$currentDate, $totalProcessed]);

            $syncLog[] = "Synced date: $currentDate - $totalProcessed tasks";
            $currentDate = date('Y-m-d', strtotime($currentDate . ' +1 day'));
        }
    }

    echo json_encode([
        'success' => true,
        'processed_tasks' => $totalProcessed,
        'sync_log' => $syncLog,
        'from' => $fromDate,
        'to' => $toDate
    ]);

} catch (Exception $e) {
    // Log failure in background sync history table even for manual triggers
    if (isset($fromDate)) {
        try {
            $logSql = "INSERT INTO desktime_sync_log (sync_date, status, hours_synced, projects_synced, error_message, sync_type) VALUES (?, 'failure', 0, 0, ?, 'manual')";
            $stmt = $pdo->prepare($logSql);
            $stmt->execute([$fromDate, $e->getMessage()]);
        } catch (Exception $logErr) {
            // Ignore logging errors to focus on the original error
        }
    }

    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
