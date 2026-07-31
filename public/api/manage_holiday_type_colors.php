<?php
/**
 * manage_holiday_type_colors.php
 * Admin-configurable color for each Holiday Type (Configuration > Scheduling >
 * Holiday). One color per type drives both the indicator on the calendar chip
 * and the Type badge in the List view (Scheduling > Holidays) — there is a
 * single source of truth here, not a separate setting per surface.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$method = $_SERVER['REQUEST_METHOD'];
$validTypes = ['non_working', 'working', 'campaign_defined'];

if ($method === 'GET') {
    try {
        $stmt = $pdo->query("SELECT holiday_type, color FROM org_holiday_type_colors");
        $colors = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(['success' => true, 'colors' => $colors]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'PUT') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $colors = $data['colors'] ?? null;

    if (!is_array($colors) || count($colors) === 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'colors array is required']);
        exit;
    }

    foreach ($colors as $entry) {
        $type = $entry['holiday_type'] ?? null;
        $color = $entry['color'] ?? null;

        if (!in_array($type, $validTypes, true)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => "Unknown holiday_type: $type"]);
            exit;
        }
        if (!$color || !preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => "color for $type must be a hex value like #RRGGBB"]);
            exit;
        }
    }

    try {
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("UPDATE org_holiday_type_colors SET color = ? WHERE holiday_type = ?");
        foreach ($colors as $entry) {
            $stmt->execute([$entry['color'], $entry['holiday_type']]);
        }
        $pdo->commit();

        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
?>
