<?php
/**
 * get_database_info.php
 * Simple API to retrieve the list of database tables, schemas, and recent records.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

session_start();
if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized session. Please log in first.']);
    exit;
}

$action = $_GET['action'] ?? 'list';

try {
    // Fetch all tables to prevent SQL injection by validating requested table names against a strict whitelist
    $stmt = $pdo->query("SHOW TABLES");
    $allTables = $stmt->fetchAll(PDO::FETCH_COLUMN);

    if ($action === 'list') {
        $tablesList = [];
        foreach ($allTables as $tableName) {
            // Count rows dynamically for each table
            $countStmt = $pdo->query("SELECT COUNT(*) FROM `$tableName`");
            $rowCount = $countStmt->fetchColumn();
            
            $tablesList[] = [
                'name' => $tableName,
                'rows' => (int)$rowCount
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
        $schemaStmt = $pdo->query("DESCRIBE `$table`");
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

        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM `$table` $whereSql");
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
        $schemaStmt = $pdo->query("DESCRIBE `$table`");
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
        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM `$table` $whereSql");
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
        $recordsStmt = $pdo->prepare("SELECT * FROM `$table` $whereSql $orderBy $limitSql");
        $recordsStmt->execute($params);
        $records = $recordsStmt->fetchAll(PDO::FETCH_ASSOC);

        // Also query total rows in table for statistics
        $totalStmt = $pdo->query("SELECT COUNT(*) FROM `$table`");
        $totalCount = (int)$totalStmt->fetchColumn();

        echo json_encode([
            'success' => true,
            'table' => $table,
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
