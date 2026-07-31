<?php
/**
 * bulk_create_holidays.php
 * Creates many holidays in one all-or-nothing transaction, for the Bulk Add
 * Holidays modal (Manual Entry / Import / Generate Official Holidays all funnel
 * through here). Every row is validated — including duplicates against both the
 * rest of the batch and the existing calendar — before anything is written; on
 * any failure nothing is saved, and the response identifies exactly which rows
 * (by their position in the submitted array) need fixing.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'HolidayValidation.php';

try {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $rows = $data['holidays'] ?? [];

    if (!is_array($rows) || count($rows) === 0) {
        throw new Exception('No holidays to save.');
    }

    $clean = [];
    $errors = [];
    $seenInBatch = [];

    foreach ($rows as $index => $row) {
        try {
            [$name, $date, $country, $type, $description] = validateHolidayInput($row);

            $key = $country . '|' . $date;
            if (isset($seenInBatch[$key])) {
                throw new Exception('Duplicate of another row in this batch (same country and date).');
            }
            $seenInBatch[$key] = true;

            $clean[$index] = compact('name', 'date', 'country', 'type', 'description');
        } catch (Exception $e) {
            $errors[] = ['index' => $index, 'message' => $e->getMessage()];
        }
    }

    // Cross-check the rows that passed per-row validation against what's already saved.
    if (!empty($clean)) {
        $placeholders = implode(',', array_fill(0, count($clean), '(?,?)'));
        $params = [];
        foreach ($clean as $row) {
            $params[] = $row['country'];
            $params[] = $row['date'];
        }
        $stmt = $pdo->prepare("SELECT country_code, holiday_date FROM org_holidays WHERE (country_code, holiday_date) IN ($placeholders)");
        $stmt->execute($params);
        $existing = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $existing[$r['country_code'] . '|' . $r['holiday_date']] = true;
        }

        foreach ($clean as $index => $row) {
            if (isset($existing[$row['country'] . '|' . $row['date']])) {
                $errors[] = ['index' => $index, 'message' => 'A holiday already exists for that country on that date.'];
                unset($clean[$index]);
            }
        }
    }

    if (!empty($errors)) {
        http_response_code(422);
        echo json_encode(['success' => false, 'errors' => $errors]);
        exit;
    }

    $pdo->beginTransaction();
    $stmt = $pdo->prepare("
        INSERT INTO org_holidays (name, holiday_date, country_code, holiday_type, description)
        VALUES (:name, :holiday_date, :country_code, :holiday_type, :description)
    ");
    foreach ($clean as $row) {
        $stmt->execute([
            'name' => $row['name'],
            'holiday_date' => $row['date'],
            'country_code' => $row['country'],
            'holiday_type' => $row['type'],
            'description' => $row['description']
        ]);
    }
    $pdo->commit();

    echo json_encode(['success' => true, 'created' => count($clean)]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if ((int) $e->getCode() === 23000) {
        http_response_code(409);
        echo json_encode(['success' => false, 'error' => 'One of these holidays was just added by someone else. Please refresh and try again.']);
    } else {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
