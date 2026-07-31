<?php
/**
 * manage_holidays.php
 * Create/update/delete entries in the company holiday calendar
 * (Scheduling > Holidays). One holiday per country per date — enforced by a
 * unique key on (country_code, holiday_date), surfaced here as a friendly
 * validation error instead of a raw SQL exception.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'HolidayValidation.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];

    try {
        [$name, $date, $country, $type, $description] = validateHolidayInput($data);

        $stmt = $pdo->prepare("
            INSERT INTO org_holidays (name, holiday_date, country_code, holiday_type, description)
            VALUES (:name, :holiday_date, :country_code, :holiday_type, :description)
        ");
        $stmt->execute([
            'name' => $name,
            'holiday_date' => $date,
            'country_code' => $country,
            'holiday_type' => $type,
            'description' => $description
        ]);

        echo json_encode(['success' => true, 'id' => (int) $pdo->lastInsertId()]);
    } catch (PDOException $e) {
        if ((int) $e->getCode() === 23000) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'A holiday already exists for that country on that date.']);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'PUT') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = isset($data['id']) ? (int) $data['id'] : null;

    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'id is required']);
        exit;
    }

    try {
        [$name, $date, $country, $type, $description] = validateHolidayInput($data);

        $stmt = $pdo->prepare("
            UPDATE org_holidays
            SET name = :name, holiday_date = :holiday_date, country_code = :country_code,
                holiday_type = :holiday_type, description = :description
            WHERE id = :id
        ");
        $stmt->execute([
            'name' => $name,
            'holiday_date' => $date,
            'country_code' => $country,
            'holiday_type' => $type,
            'description' => $description,
            'id' => $id
        ]);

        echo json_encode(['success' => true]);
    } catch (PDOException $e) {
        if ((int) $e->getCode() === 23000) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'A holiday already exists for that country on that date.']);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
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
        $stmt = $pdo->prepare("DELETE FROM org_holidays WHERE id = ?");
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
