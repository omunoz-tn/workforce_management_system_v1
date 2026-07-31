<?php
/**
 * get_holidays.php
 * Reusable read endpoint for the company holiday calendar. Consumed by the
 * Holidays screen (Scheduling > Holidays) and, going forward, by Forecast and
 * Run Rate calculations that need to know whether a given date is a holiday.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

try {
    $where = [];
    $params = [];

    if (!empty($_GET['country'])) {
        $where[] = 'country_code = :country';
        $params['country'] = strtoupper($_GET['country']);
    }
    if (!empty($_GET['year'])) {
        $where[] = 'YEAR(holiday_date) = :year';
        $params['year'] = (int) $_GET['year'];
    }
    if (!empty($_GET['month'])) {
        $where[] = 'MONTH(holiday_date) = :month';
        $params['month'] = (int) $_GET['month'];
    }
    if (!empty($_GET['from'])) {
        $where[] = 'holiday_date >= :from';
        $params['from'] = $_GET['from'];
    }
    if (!empty($_GET['to'])) {
        $where[] = 'holiday_date <= :to';
        $params['to'] = $_GET['to'];
    }
    if (!empty($_GET['search'])) {
        $where[] = 'name LIKE :search';
        $params['search'] = '%' . $_GET['search'] . '%';
    }

    $sql = 'SELECT id, name, holiday_date, country_code, holiday_type, description, created_at, updated_at
            FROM org_holidays';
    if (!empty($where)) {
        $sql .= ' WHERE ' . implode(' AND ', $where);
    }
    $sql .= ' ORDER BY holiday_date ASC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $holidays = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode(['success' => true, 'holidays' => $holidays]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
