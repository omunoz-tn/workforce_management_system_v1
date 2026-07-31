<?php
/**
 * generate_official_holidays.php
 * Looks up the official public holidays for a supported country/year (via
 * HolidayGenerator) and reports which ones are new vs. already saved in
 * org_holidays for that country/date, so the Bulk Add modal can populate its
 * editable table with only the holidays that still need to be created.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'HolidayGenerator.php';

try {
    $country = strtoupper(trim($_GET['country'] ?? ''));
    $year = isset($_GET['year']) ? (int) $_GET['year'] : null;

    if (!HolidayGenerator::isSupported($country)) {
        throw new Exception('Unsupported country code.');
    }
    if (!$year || $year < 1970 || $year > 2100) {
        throw new Exception('A valid year is required.');
    }

    $generated = HolidayGenerator::generate($country, $year);

    $stmt = $pdo->prepare("SELECT holiday_date FROM org_holidays WHERE country_code = :country AND YEAR(holiday_date) = :year");
    $stmt->execute(['country' => $country, 'year' => $year]);
    $existingDates = array_flip($stmt->fetchAll(PDO::FETCH_COLUMN));

    $newHolidays = [];
    $skippedCount = 0;
    foreach ($generated as $holiday) {
        if (isset($existingDates[$holiday['holiday_date']])) {
            $skippedCount++;
        } else {
            $holiday['country_code'] = $country;
            $newHolidays[] = $holiday;
        }
    }

    echo json_encode([
        'success' => true,
        'holidays' => $newHolidays,
        'generated_count' => count($newHolidays),
        'skipped_count' => $skippedCount
    ]);
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
