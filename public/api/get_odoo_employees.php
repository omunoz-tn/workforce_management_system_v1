<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

session_start();
$isRestricted = isset($_SESSION['allowed_teams']) && !empty($_SESSION['allowed_teams']) && $_SESSION['role_name'] !== 'Admin';
$allowedTeams = $isRestricted ? $_SESSION['allowed_teams'] : [];

try {
    // Get query parameters
    $page = isset($_GET['page']) ? max(1, intval($_GET['page'])) : 1;
    $limit = isset($_GET['limit']) ? max(1, min(100, intval($_GET['limit']))) : 10;
    $requestedColumns = isset($_GET['columns']) ? explode(',', $_GET['columns']) : [];

    $offset = ($page - 1) * $limit;
    $search = isset($_GET['search']) ? trim($_GET['search']) : '';
    $sort = isset($_GET['sort']) ? trim($_GET['sort']) : 'employee_name';
    $order = isset($_GET['order']) && strtolower($_GET['order']) === 'desc' ? 'DESC' : 'ASC';

    // First, get all available columns from the table
    $stmt = $pdo->query("DESCRIBE odoo_employee_data");
    $columnsInfo = $stmt->fetchAll();
    $allColumns = array_column($columnsInfo, 'Field');

    // Identify searchable columns (text-based)
    $searchableColumns = [];
    foreach ($columnsInfo as $col) {
        $type = strtolower($col['Type']);
        if (strpos($type, 'char') !== false || strpos($type, 'text') !== false) {
            $searchableColumns[] = $col['Field'];
        }
    }

    // Determine which columns to select
    if (!empty($requestedColumns)) {
        $columnsToSelect = array_intersect($requestedColumns, $allColumns);
        if (empty($columnsToSelect)) {
            $columnsToSelect = $allColumns;
        }
    } else {
        $columnsToSelect = $allColumns;
    }

    // Build the SELECT query
    $columnList = implode(', ', array_map(function ($col) {
        return "`$col`";
    }, $columnsToSelect));

    // Build the WHERE clause for search and date filtering
    $whereParts = [];
    $params = [];

    if ($isRestricted) {
        $whereParts[] = "employee_id IN (SELECT employee_id FROM org_team_assignments WHERE team_id IN (" . implode(',', array_map('intval', $allowedTeams)) . "))";
    }

    if ($search !== "") {
        $searchParts = [];
        foreach ($searchableColumns as $col) {
            $searchParts[] = "`$col` LIKE :search";
        }
        if (!empty($searchParts)) {
            $whereParts[] = "(" . implode(" OR ", $searchParts) . ")";
            $params[':search'] = "%$search%";
        }
    }

    $whereClause = "";
    if (!empty($whereParts)) {
        $whereClause = " WHERE " . implode(" AND ", $whereParts);
    }

    // Get total count (with filters)
    $countSql = "SELECT COUNT(*) FROM odoo_employee_data $whereClause";
    $countStmt = $pdo->prepare($countSql);
    foreach ($params as $key => $val) {
        $countStmt->bindValue($key, $val);
    }
    $countStmt->execute();
    $totalRecords = $countStmt->fetchColumn();

    // Get paginated data (with sorting)
    $sortColumn = in_array($sort, $allColumns) ? "`$sort`" : "`employee_name`";
    $sql = "SELECT $columnList FROM odoo_employee_data $whereClause ORDER BY $sortColumn $order LIMIT :limit OFFSET :offset";
    $stmt = $pdo->prepare($sql);
    foreach ($params as $key => $val) {
        $stmt->bindValue($key, $val);
    }
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $data = $stmt->fetchAll();

    // Calculate pagination metadata
    $totalPages = ceil($totalRecords / $limit);

    echo json_encode([
        'success' => true,
        'data' => $data,
        'meta' => [
            'currentPage' => $page,
            'pageSize' => $limit,
            'totalRecords' => $totalRecords,
            'totalPages' => $totalPages,
            'hasNextPage' => $page < $totalPages,
            'hasPrevPage' => $page > 1
        ],
        'availableColumns' => $allColumns
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>
