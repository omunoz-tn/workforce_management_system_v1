<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

/**
 * get_project_analytics.php
 * Fetches aggregated metrics and data visualizations for the Project Analytics Dashboard.
 */

try {
    $fromDate = isset($_GET['from']) ? $_GET['from'] : date('Y-m-d');
    $toDate = isset($_GET['to']) ? $_GET['to'] : $fromDate;

    $filterTeam = isset($_GET['team']) && $_GET['team'] !== '' ? $_GET['team'] : null;
    $filterEmployee = isset($_GET['employee']) && $_GET['employee'] !== '' ? $_GET['employee'] : null;
    $filterProject = isset($_GET['project']) && $_GET['project'] !== '' ? $_GET['project'] : null;
    $filterAccount = isset($_GET['account']) && $_GET['account'] !== '' ? $_GET['account'] : null;

    // Helper to build dynamic query filters
    function buildFilters($filterTeam, $filterEmployee, $filterProject, $filterAccount, &$params) {
        $sql = " WHERE log_date BETWEEN :from AND :to";
        
        if ($filterTeam !== null) {
            $sql .= " AND team_name = :team";
            $params['team'] = $filterTeam;
        }
        if ($filterEmployee !== null) {
            if (is_numeric($filterEmployee)) {
                $sql .= " AND employee_id = :employee";
                $params['employee'] = intval($filterEmployee);
            } else {
                $sql .= " AND employee_name = :employee";
                $params['employee'] = $filterEmployee;
            }
        }
        if ($filterProject !== null) {
            $sql .= " AND project_title = :project";
            $params['project'] = $filterProject;
        }
        if ($filterAccount !== null) {
            $sql .= " AND api_account = :account";
            $params['account'] = $filterAccount;
        }
        return $sql;
    }

    // Base parameters
    $baseParams = [
        'from' => $fromDate,
        'to' => $toDate
    ];

    $whereClause = buildFilters($filterTeam, $filterEmployee, $filterProject, $filterAccount, $baseParams);

    // 1. KPIs Summary Query
    $kpiSql = "SELECT 
                COALESCE(SUM(duration_seconds), 0) as total_duration,
                COUNT(DISTINCT project_title) as active_projects,
                COUNT(DISTINCT employee_id) as active_agents,
                COUNT(DISTINCT task_title) as active_tasks,
                COALESCE(AVG(duration_seconds), 0) as avg_task_duration
              FROM desktime_project_data" . $whereClause;
    
    $stmt = $pdo->prepare($kpiSql);
    $stmt->execute($baseParams);
    $kpi = $stmt->fetch(PDO::FETCH_ASSOC);

    // 2. Trend Query (Daily effort)
    $trendSql = "SELECT 
                    log_date as date,
                    COALESCE(SUM(duration_seconds), 0) as duration
                 FROM desktime_project_data" . $whereClause . "
                 GROUP BY log_date
                 ORDER BY log_date ASC";
    
    $stmt = $pdo->prepare($trendSql);
    $stmt->execute($baseParams);
    $trend = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 3. Project Distribution Query
    $projectSql = "SELECT 
                    COALESCE(NULLIF(project_title, ''), 'Unassigned Project') as name,
                    COALESCE(SUM(duration_seconds), 0) as value
                   FROM desktime_project_data" . $whereClause . "
                   GROUP BY project_title
                   ORDER BY value DESC
                   LIMIT 20";
    
    $stmt = $pdo->prepare($projectSql);
    $stmt->execute($baseParams);
    $projects = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 4. Employee/Agent Distribution Query
    $agentSql = "SELECT 
                    employee_name as name,
                    team_name as team,
                    COALESCE(SUM(duration_seconds), 0) as value
                 FROM desktime_project_data" . $whereClause . "
                 GROUP BY employee_id, employee_name, team_name
                 ORDER BY value DESC
                 LIMIT 15";
    
    $stmt = $pdo->prepare($agentSql);
    $stmt->execute($baseParams);
    $agents = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 5. Team Distribution Query
    $teamSql = "SELECT 
                    COALESCE(NULLIF(team_name, ''), 'Unassigned Team') as name,
                    COALESCE(SUM(duration_seconds), 0) as value
                 FROM desktime_project_data" . $whereClause . "
                 GROUP BY team_name
                 ORDER BY value DESC";
    
    $stmt = $pdo->prepare($teamSql);
    $stmt->execute($baseParams);
    $teams = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 6. Top Tasks Query
    $taskSql = "SELECT 
                    COALESCE(NULLIF(task_title, ''), 'No Task Title') as name,
                    COALESCE(NULLIF(project_title, ''), 'Unassigned') as project,
                    COALESCE(SUM(duration_seconds), 0) as value
                 FROM desktime_project_data" . $whereClause . "
                 GROUP BY task_title, project_title
                 ORDER BY value DESC
                 LIMIT 15";
    
    $stmt = $pdo->prepare($taskSql);
    $stmt->execute($baseParams);
    $tasks = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 7. Dynamic Dropdown Lists for Filters (Unfiltered within date range to show available choices)
    $filterParams = [
        'from' => $fromDate,
        'to' => $toDate
    ];
    
    $teamsListSql = "SELECT DISTINCT team_name FROM desktime_project_data WHERE log_date BETWEEN :from AND :to AND team_name IS NOT NULL AND team_name != '' ORDER BY team_name ASC";
    $stmt = $pdo->prepare($teamsListSql);
    $stmt->execute($filterParams);
    $teamsList = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $employeesListSql = "SELECT DISTINCT employee_id as id, employee_name as name FROM desktime_project_data WHERE log_date BETWEEN :from AND :to ORDER BY employee_name ASC";
    $stmt = $pdo->prepare($employeesListSql);
    $stmt->execute($filterParams);
    $employeesList = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $projectsListSql = "SELECT DISTINCT project_title FROM desktime_project_data WHERE log_date BETWEEN :from AND :to AND project_title IS NOT NULL AND project_title != '' ORDER BY project_title ASC";
    $stmt = $pdo->prepare($projectsListSql);
    $stmt->execute($filterParams);
    $projectsList = $stmt->fetchAll(PDO::FETCH_COLUMN);

    echo json_encode([
        'success' => true,
        'filters' => [
            'teams' => $teamsList,
            'employees' => $employeesList,
            'projects' => $projectsList
        ],
        'data' => [
            'kpis' => $kpi,
            'trend' => $trend,
            'projects' => $projects,
            'agents' => $agents,
            'teams' => $teams,
            'tasks' => $tasks
        ],
        'query_params' => [
            'from' => $fromDate,
            'to' => $toDate,
            'team' => $filterTeam,
            'employee' => $filterEmployee,
            'project' => $filterProject,
            'account' => $filterAccount
        ]
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
