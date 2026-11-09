<?php
// Disable error output for clean JSON
ini_set('display_errors', 0);
error_reporting(0);

header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'sync_desktime_core.php';

session_start();

/**
 * Endpoint to get total hours worked per employee in a date range.
 * Expects 'from' and 'to' GET parameters (YYYY-MM-DD).
 */

try {
    $fromDate = isset($_GET['from']) ? $_GET['from'] : null;
    $toDate = isset($_GET['to']) ? $_GET['to'] : null;

    if (!$fromDate || !$toDate) {
        throw new Exception("Missing date range parameters 'from' and 'to'");
    }

    // Auto-Sync Logic (Smart Refresh) for current day
    $today = date('Y-m-d');
    if ($toDate >= $today) {
        $syncCheckQuery = "SELECT TIMESTAMPDIFF(SECOND, MAX(updated_at), NOW()) as sync_age FROM desktime_employee_data WHERE log_date = CURDATE()";
        $stmt = $pdo->query($syncCheckQuery);
        $syncInfo = $stmt->fetch(PDO::FETCH_ASSOC);

        // Age measured on the DB clock: updated_at is written with CURRENT_TIMESTAMP, and the
        // DB and PHP time zones differ (by an hour since the Nov 1 DST change), which made
        // every request look stale and run a 30s+ DeskTime sync.
        $syncAge = $syncInfo['sync_age'] === null ? PHP_INT_MAX : (int) $syncInfo['sync_age'];
        if ($syncAge > 600) { // 10 minutes
            $syncResult = syncDeskTime($pdo, $env);
            
            // Log the automatic background refresh
            $hoursCount = 0;
            foreach ($syncResult['accounts'] as $acc) {
                if (($acc['status'] ?? '') === 'success') {
                    $hoursCount += ($acc['updated_records'] ?? 0);
                }
            }
            
            $logSql = "INSERT INTO desktime_sync_log (sync_date, status, hours_updated, projects_updated, error_message, sync_type) VALUES (?, ?, ?, ?, ?, 'automatic')";
            $stmt = $pdo->prepare($logSql);
            $stmt->execute([$today, 'success', $hoursCount, 0, 'Auto-refresh from report view']);
        }
    }

    // Aggregating by employee, group, and date
    $sql = "SELECT 
                `name`, 
                `group_name`, 
                `log_date`,
                SUM(`desktime_time`) as total_seconds
            FROM desktime_employee_data 
            WHERE log_date BETWEEN :from AND :to";
    
    $sql .= team_filter_employee_sql('employee_id');

    $sql .= " GROUP BY `name`, `group_name`, `log_date`
            ORDER BY `name` ASC, `log_date` ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':from' => $fromDate,
        ':to' => $toDate
    ]);

    $results = $stmt->fetchAll();

    // Format the response
    $data = array_map(function ($row) {
        return [
            'name' => $row['name'],
            'group' => $row['group_name'],
            'date' => $row['log_date'],
            'hours' => round($row['total_seconds'] / 3600, 4),
            'seconds' => (int) $row['total_seconds']
        ];
    }, $results);

    echo json_encode([
        'success' => true,
        'from' => $fromDate,
        'to' => $toDate,
        'data' => $data
    ]);

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>