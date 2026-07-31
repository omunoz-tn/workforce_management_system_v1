<?php
/**
 * manage_holiday_country_colors.php
 * Admin-configurable chip background/text color per country (Configuration >
 * Scheduling > Holiday). Drives the calendar chip in Scheduling > Holidays so,
 * e.g., US and DO holidays can each use their own chip color.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

$method = $_SERVER['REQUEST_METHOD'];
$validCountries = ['DO', 'US'];

if ($method === 'GET') {
    try {
        $stmt = $pdo->query("SELECT country_code, color, text_color FROM org_holiday_country_colors");
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
        $code = $entry['country_code'] ?? null;
        $color = $entry['color'] ?? null;
        $textColor = $entry['text_color'] ?? null;

        if (!in_array($code, $validCountries, true)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => "Unknown country_code: $code"]);
            exit;
        }
        if (!$color || !preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => "color for $code must be a hex value like #RRGGBB"]);
            exit;
        }
        if (!$textColor || !preg_match('/^#[0-9A-Fa-f]{6}$/', $textColor)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => "text_color for $code must be a hex value like #RRGGBB"]);
            exit;
        }
    }

    try {
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("UPDATE org_holiday_country_colors SET color = ?, text_color = ? WHERE country_code = ?");
        foreach ($colors as $entry) {
            $stmt->execute([$entry['color'], $entry['text_color'], $entry['country_code']]);
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
