<?php
/**
 * Shared validation for a single holiday row, used by both manage_holidays.php
 * (single create/update) and bulk_create_holidays.php (bulk create).
 */

// Extendable as more countries are supported.
const HOLIDAY_SUPPORTED_COUNTRIES = ['DO', 'US'];
const HOLIDAY_TYPES = ['non_working', 'working', 'campaign_defined'];

/**
 * @return array{0:string,1:string,2:string,3:string,4:?string} [name, date, country, type, description]
 * @throws Exception on the first invalid field
 */
function validateHolidayInput($data)
{
    $name = trim($data['name'] ?? '');
    $date = trim($data['holiday_date'] ?? '');
    $country = strtoupper(trim($data['country_code'] ?? ''));
    $type = trim($data['holiday_type'] ?? '');
    $description = isset($data['description']) ? trim($data['description']) : null;

    if ($name === '') {
        throw new Exception('Holiday name is required.');
    }
    if (!$date || !DateTime::createFromFormat('Y-m-d', $date)) {
        throw new Exception('A valid date is required.');
    }
    if (!in_array($country, HOLIDAY_SUPPORTED_COUNTRIES, true)) {
        throw new Exception('Unsupported country code.');
    }
    if (!in_array($type, HOLIDAY_TYPES, true)) {
        throw new Exception('Invalid holiday type.');
    }

    return [$name, $date, $country, $type, $description === '' ? null : $description];
}
