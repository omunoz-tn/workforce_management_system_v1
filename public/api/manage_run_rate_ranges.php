<?php
/**
 * manage_run_rate_ranges.php
 * Manages the admin-configurable color bands used to color the Run Rate status
 * bar. Each range only stores a starting percentage ("floor"): the band that
 * applies to a value is the one with the greatest range_start <= value, so
 * there is no separate "end" to keep in sync and no gap between bands.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    try {
        $stmt = $pdo->query("SELECT id, range_start, color, is_blinking FROM org_run_rate_color_ranges ORDER BY range_start DESC");
        $ranges = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(['success' => true, 'ranges' => $ranges]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $id = isset($data['id']) && $data['id'] !== '' ? (int) $data['id'] : null;
    $rangeStart = isset($data['range_start']) ? $data['range_start'] : null;
    $color = $data['color'] ?? null;
    $isBlinking = !empty($data['is_blinking']) ? 1 : 0;

    if ($rangeStart === null || $rangeStart === '' || !is_numeric($rangeStart)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'range_start must be a number']);
        exit;
    }

    if (!$color || !preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'color must be a hex value like #RRGGBB']);
        exit;
    }

    try {
        if ($id) {
            $stmt = $pdo->prepare("UPDATE org_run_rate_color_ranges SET range_start = ?, color = ?, is_blinking = ? WHERE id = ?");
            $stmt->execute([$rangeStart, $color, $isBlinking, $id]);
        } else {
            $stmt = $pdo->prepare("INSERT INTO org_run_rate_color_ranges (range_start, color, is_blinking) VALUES (?, ?, ?)");
            $stmt->execute([$rangeStart, $color, $isBlinking]);
        }

        echo json_encode(['success' => true]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'A range already starts at that percentage.']);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
    }
    exit;
}

if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : null;

    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'id is required']);
        exit;
    }

    try {
        $stmt = $pdo->prepare("DELETE FROM org_run_rate_color_ranges WHERE id = ?");
        $stmt->execute([$id]);

        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
?>
