<?php
/**
 * get_database_info.php
 * Simple API to retrieve the list of database tables, schemas, and recent records.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'db_sources.php';

session_start();
if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized session. Please log in first.']);
    exit;
}

$action = $_GET['action'] ?? 'list';

// Which server the rest of this request reads. Resolved through the whitelist in
// db_sources.php -- the id names a DSN, so an unknown one is rejected here rather than
// dialled. Absent means the platform database, which is what every caller meant before
// there was a second source.
$sourceId = $_GET['source'] ?? 'wfm';

try {
    if ($action === 'sources') {
        // `warnings` names any server that could not be listed. Reported alongside the
        // sources that did answer, so one unreachable server does not blank the picker.
        $catalog = db_sources_list($env);
        echo json_encode([
            'success' => true,
            'sources' => $catalog['sources'],
            'warnings' => $catalog['warnings']
        ]);
        exit;
    }

    $db = db_source_connect($sourceId, $env, $pdo);

    // Fetch all tables to prevent SQL injection by validating requested table names against a strict whitelist
    $stmt = $db->query("SHOW TABLES");
    $allTables = $stmt->fetchAll(PDO::FETCH_COLUMN);

    if ($action === 'list') {
        $tablesList = [];
        foreach ($allTables as $tableName) {
            // Count rows dynamically for each table. A single unreadable object -- a view
            // over a table this account has no grant on, which is ordinary on a database
            // the platform does not own -- must not take the whole listing down with it,
            // so it is listed without a count instead.
            try {
                $countStmt = $db->query("SELECT COUNT(*) FROM `$tableName`");
                $rowCount = (int) $countStmt->fetchColumn();
            } catch (PDOException $e) {
                $rowCount = null;
            }

            $tablesList[] = [
                'name' => $tableName,
                'rows' => $rowCount
            ];
        }

        echo json_encode([
            'success' => true,
            'tables' => $tablesList
        ]);
        exit;
    }

    if ($action === 'count') {
        $table = $_GET['table'] ?? '';
        if (!in_array($table, $allTables)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid table name.']);
            exit;
        }

        // Get Schema to know available columns
        $schemaStmt = $db->query("DESCRIBE `$table`");
        $schema = $schemaStmt->fetchAll(PDO::FETCH_ASSOC);
        $columns = array_column($schema, 'Field');

        // Dynamically build the WHERE filters
        $whereParts = [];
        $params = [];

        $startDate = $_GET['start_date'] ?? null;
        $endDate = $_GET['end_date'] ?? null;
        if ($startDate && $endDate) {
            $dateCol = null;
            if (in_array('log_date', $columns)) {
                $dateCol = 'log_date';
            } else if (in_array('created_at', $columns)) {
                $dateCol = 'created_at';
            } else if (in_array('timestamp', $columns)) {
                $dateCol = 'timestamp';
            } else if (in_array('updated_at', $columns)) {
                $dateCol = 'updated_at';
            }

            if ($dateCol) {
                if ($dateCol === 'log_date') {
                    $whereParts[] = "`$dateCol` BETWEEN :start_date AND :end_date";
                    $params['start_date'] = $startDate;
                    $params['end_date'] = $endDate;
                } else {
                    $whereParts[] = "`$dateCol` BETWEEN :start_date AND :end_date";
                    $params['start_date'] = $startDate . " 00:00:00";
                    $params['end_date'] = $endDate . " 23:59:59";
                }
            }
        }

        $filterName = $_GET['filter_name'] ?? null;
        if ($filterName && trim($filterName) !== '') {
            $nameCol = null;
            if (in_array('name', $columns)) {
                $nameCol = 'name';
            } else if (in_array('employee_name', $columns)) {
                $nameCol = 'employee_name';
            }

            if ($nameCol) {
                $whereParts[] = "`$nameCol` LIKE :filter_name";
                $params['filter_name'] = '%' . $filterName . '%';
            }
        }

        $filterTeam = $_GET['filter_team'] ?? null;
        if ($filterTeam && trim($filterTeam) !== '') {
            $teamCol = null;
            if (in_array('group_name', $columns)) {
                $teamCol = 'group_name';
            } else if (in_array('team_name', $columns)) {
                $teamCol = 'team_name';
            }

            if ($teamCol) {
                $whereParts[] = "`$teamCol` LIKE :filter_team";
                $params['filter_team'] = '%' . $filterTeam . '%';
            }
        }

        $whereSql = "";
        if (!empty($whereParts)) {
            $whereSql = "WHERE " . implode(" AND ", $whereParts);
        }

        $countStmt = $db->prepare("SELECT COUNT(*) FROM `$table` $whereSql");
        $countStmt->execute($params);
        $count = (int)$countStmt->fetchColumn();

        echo json_encode([
            'success' => true,
            'count' => $count
        ]);
        exit;
    }

    if ($action === 'details') {
        $table = $_GET['table'] ?? '';
        if (!in_array($table, $allTables)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid table name.']);
            exit;
        }

        // 1. Get Table Schema
        $schemaStmt = $db->query("DESCRIBE `$table`");
        $schema = $schemaStmt->fetchAll(PDO::FETCH_ASSOC);
        $columns = array_column($schema, 'Field');

        // Dynamically build the WHERE filters
        $whereParts = [];
        $params = [];

        $startDate = $_GET['start_date'] ?? null;
        $endDate = $_GET['end_date'] ?? null;
        if ($startDate && $endDate) {
            $dateCol = null;
            if (in_array('log_date', $columns)) {
                $dateCol = 'log_date';
            } else if (in_array('created_at', $columns)) {
                $dateCol = 'created_at';
            } else if (in_array('timestamp', $columns)) {
                $dateCol = 'timestamp';
            } else if (in_array('updated_at', $columns)) {
                $dateCol = 'updated_at';
            }

            if ($dateCol) {
                if ($dateCol === 'log_date') {
                    $whereParts[] = "`$dateCol` BETWEEN :start_date AND :end_date";
                    $params['start_date'] = $startDate;
                    $params['end_date'] = $endDate;
                } else {
                    $whereParts[] = "`$dateCol` BETWEEN :start_date AND :end_date";
                    $params['start_date'] = $startDate . " 00:00:00";
                    $params['end_date'] = $endDate . " 23:59:59";
                }
            }
        }

        $filterName = $_GET['filter_name'] ?? null;
        if ($filterName && trim($filterName) !== '') {
            $nameCol = null;
            if (in_array('name', $columns)) {
                $nameCol = 'name';
            } else if (in_array('employee_name', $columns)) {
                $nameCol = 'employee_name';
            }

            if ($nameCol) {
                $whereParts[] = "`$nameCol` LIKE :filter_name";
                $params['filter_name'] = '%' . $filterName . '%';
            }
        }

        $filterTeam = $_GET['filter_team'] ?? null;
        if ($filterTeam && trim($filterTeam) !== '') {
            $teamCol = null;
            if (in_array('group_name', $columns)) {
                $teamCol = 'group_name';
            } else if (in_array('team_name', $columns)) {
                $teamCol = 'team_name';
            }

            if ($teamCol) {
                $whereParts[] = "`$teamCol` LIKE :filter_team";
                $params['filter_team'] = '%' . $filterTeam . '%';
            }
        }

        $whereSql = "";
        if (!empty($whereParts)) {
            $whereSql = "WHERE " . implode(" AND ", $whereParts);
        }

        // 2. Get Matching Row Count first
        $countStmt = $db->prepare("SELECT COUNT(*) FROM `$table` $whereSql");
        $countStmt->execute($params);
        $matchingCount = (int)$countStmt->fetchColumn();

        // 3. Perform Safety Check: If custom filter is applied OR limit is set to all
        $limit = $_GET['limit'] ?? '50';
        $limitSql = "LIMIT 50";
        $isCapped = false;

        $hasFilters = !empty($whereParts);
        if ($hasFilters || $limit === 'all') {
            if ($matchingCount > 10000) {
                http_response_code(400);
                echo json_encode([
                    'success' => false,
                    'error' => "Safety Limit Exceeded: The selection contains " . number_format($matchingCount) . " records, which exceeds the safety limit of 10,000. Please select a shorter date range or apply more specific filters."
                ]);
                exit;
            }
            $limitSql = ""; // Safe to retrieve all matching rows
        }

        // Determine ordering column
        $orderBy = '';
        if (in_array('id', $columns)) {
            $orderBy = 'ORDER BY id DESC';
        } else if (in_array('created_at', $columns)) {
            $orderBy = 'ORDER BY created_at DESC';
        } else if (in_array('log_date', $columns)) {
            $orderBy = 'ORDER BY log_date DESC';
        }

        // 4. Get Records
        $recordsStmt = $db->prepare("SELECT * FROM `$table` $whereSql $orderBy $limitSql");
        $recordsStmt->execute($params);
        $records = $recordsStmt->fetchAll(PDO::FETCH_ASSOC);

        // Also query total rows in table for statistics. Only a statistic, so it degrades
        // to null rather than costing the user the rows they asked for.
        try {
            $totalStmt = $db->query("SELECT COUNT(*) FROM `$table`");
            $totalCount = (int) $totalStmt->fetchColumn();
        } catch (PDOException $e) {
            $totalCount = null;
        }

        echo json_encode([
            'success' => true,
            'table' => $table,
            // Where this schema was read from. Resolved through the same path that opened
            // the connection, so the viewer can name the server holding a table instead of
            // leaving an admin to guess which of the configured sources is selected.
            'connection' => db_source_describe($sourceId, $env),
            'rows' => $totalCount,
            'matching_rows' => $matchingCount,
            'schema' => $schema,
            'records' => $records,
            'is_capped' => $isCapped,
            'cap_limit' => 10000
        ]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid action.']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
