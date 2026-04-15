<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $page = isset($_GET['page']) ? max(1, intval($_GET['page'])) : 1;
    $limit = isset($_GET['limit']) ? max(1, min(100, intval($_GET['limit']))) : 10;
    $offset = ($page - 1) * $limit;
    $search = isset($_GET['search']) ? trim($_GET['search']) : '';
    $sort = isset($_GET['sort']) ? trim($_GET['sort']) : 'name';
    $order = isset($_GET['order']) && strtolower($_GET['order']) === 'desc' ? 'DESC' : 'ASC';

    // Get latest date for desktime data
    $latestDate = $pdo->query("SELECT MAX(log_date) FROM desktime_employee_data")->fetchColumn();

    // Query template
    $baseSql = "FROM desktime_employee_data d
                LEFT JOIN org_team_assignments ota ON d.name = ota.employee_id
                LEFT JOIN org_teams ot ON ota.team_id = ot.id
                WHERE d.log_date = :latest_date";
    
    $params = [':latest_date' => $latestDate];

    if ($search !== "") {
        $baseSql .= " AND (d.name LIKE :search OR d.group_name LIKE :search OR ot.name LIKE :search)";
        $params[':search'] = "%$search%";
    }

    // Count records
    $countSql = "SELECT COUNT(*) $baseSql";
    $countStmt = $pdo->prepare($countSql);
    foreach ($params as $key => $val) {
        $countStmt->bindValue($key, $val);
    }
    $countStmt->execute();
    $totalRecords = $countStmt->fetchColumn();

    // Fetch data
    $fetchColumns = "d.name, d.group_name as desktime_group, ot.name as hierarchy_team";
    $allowedSort = ['name', 'desktime_group', 'hierarchy_team'];
    $sortCol = in_array($sort, $allowedSort) ? $sort : 'name';
    
    // Disambiguate name and group_name
    if ($sortCol === 'name') $sortCol = "d.name";
    if ($sortCol === 'desktime_group') $sortCol = "d.group_name";
    if ($sortCol === 'hierarchy_team') $sortCol = "ot.name";

    $sql = "SELECT $fetchColumns $baseSql ORDER BY $sortCol $order LIMIT :limit OFFSET :offset";
    $stmt = $pdo->prepare($sql);
    foreach ($params as $key => $val) {
        $stmt->bindValue($key, $val);
    }
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data' => $data,
        'meta' => [
            'currentPage' => $page,
            'pageSize' => $limit,
            'totalRecords' => $totalRecords,
            'totalPages' => ceil($totalRecords / $limit),
            'hasNextPage' => $page < ceil($totalRecords / $limit),
            'hasPrevPage' => $page > 1
        ]
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>
