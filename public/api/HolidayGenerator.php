<?php
/**
 * HolidayGenerator
 *
 * Produces the official public-holiday list for a supported country/year.
 * Deliberately kept independent from the Holidays CRUD module (manage_holidays.php)
 * so it can later be swapped for a call to an external holiday provider/API, or
 * extended to more countries, without touching the Holidays UI or storage layer.
 *
 * Every generated holiday is a best-effort starting point — the caller (see
 * generate_official_holidays.php) always presents these as editable rows before
 * anything is saved, so minor observance-rule edge cases are correctable by the user
 * rather than silently wrong.
 */
class HolidayGenerator
{
    /** @var array<string,string> Supported country codes and display names. */
    private static $SUPPORTED = [
        'US' => 'United States',
        'DO' => 'Dominican Republic',
    ];

    public static function supportedCountries()
    {
        return self::$SUPPORTED;
    }

    public static function isSupported($countryCode)
    {
        return isset(self::$SUPPORTED[$countryCode]);
    }

    /**
     * @return array<int, array{name:string, holiday_date:string, holiday_type:string, description:string}>
     */
    public static function generate($countryCode, $year)
    {
        switch ($countryCode) {
            case 'US':
                return self::unitedStates((int) $year);
            case 'DO':
                return self::dominicanRepublic((int) $year);
            default:
                throw new Exception("No holiday generator available for country: $countryCode");
        }
    }

    // --- Date helpers -----------------------------------------------------

    private static function date($year, $month, $day)
    {
        return (new DateTime())->setDate($year, $month, $day)->format('Y-m-d');
    }

    /** Nth weekday of a month. $weekday: 1=Mon..7=Sun (ISO-8601), $n: 1st, 2nd, 3rd... */
    private static function nthWeekday($year, $month, $weekday, $n)
    {
        $d = new DateTime();
        $d->setDate($year, $month, 1);
        $firstWeekday = (int) $d->format('N');
        $offset = ($weekday - $firstWeekday + 7) % 7;
        $day = 1 + $offset + ($n - 1) * 7;
        $d->setDate($year, $month, $day);
        return $d->format('Y-m-d');
    }

    /** Last given weekday of a month. */
    private static function lastWeekday($year, $month, $weekday)
    {
        $d = new DateTime();
        $d->setDate($year, $month, 1);
        $d->modify('last day of this month');
        $lastWeekday = (int) $d->format('N');
        $diff = ($lastWeekday - $weekday + 7) % 7;
        $d->modify("-$diff days");
        return $d->format('Y-m-d');
    }

    /** Gregorian Easter Sunday (Anonymous Gregorian / Meeus algorithm). */
    private static function easterDate($year)
    {
        $a = $year % 19;
        $b = intdiv($year, 100);
        $c = $year % 100;
        $d = intdiv($b, 4);
        $e = $b % 4;
        $f = intdiv($b + 8, 25);
        $g = intdiv($b - $f + 1, 3);
        $h = (19 * $a + $b - $d - $g + 15) % 30;
        $i = intdiv($c, 4);
        $k = $c % 4;
        $l = (32 + 2 * $e + 2 * $i - $h - $k) % 7;
        $m = intdiv($a + 11 * $h + 22 * $l, 451);
        $month = intdiv($h + $l - 7 * $m + 114, 31);
        $day = (($h + $l - 7 * $m + 114) % 31) + 1;
        return new DateTime("$year-$month-$day");
    }

    /**
     * Dominican Law 139-97: a holiday that falls Tue/Wed is observed the Monday
     * before; one that falls Thu is observed the following Monday. Fri/Sat/Sun/Mon
     * are left on their actual date.
     */
    private static function moveToMondayIfNeeded($dateStr)
    {
        $d = new DateTime($dateStr);
        $dow = (int) $d->format('N'); // 1=Mon..7=Sun
        if ($dow === 2) {
            $d->modify('-1 day');
        } elseif ($dow === 3) {
            $d->modify('-2 days');
        } elseif ($dow === 4) {
            $d->modify('+4 days');
        }
        return $d->format('Y-m-d');
    }

    // --- Country generators -------------------------------------------------

    private static function unitedStates($year)
    {
        return [
            ['name' => "New Year's Day", 'holiday_date' => self::date($year, 1, 1), 'holiday_type' => 'non_working', 'description' => 'US federal holiday.'],
            ['name' => 'Martin Luther King Jr. Day', 'holiday_date' => self::nthWeekday($year, 1, 1, 3), 'holiday_type' => 'non_working', 'description' => 'US federal holiday — 3rd Monday of January.'],
            ["name" => "Washington's Birthday (Presidents Day)", 'holiday_date' => self::nthWeekday($year, 2, 1, 3), 'holiday_type' => 'non_working', 'description' => 'US federal holiday — 3rd Monday of February.'],
            ['name' => 'Memorial Day', 'holiday_date' => self::lastWeekday($year, 5, 1), 'holiday_type' => 'non_working', 'description' => 'US federal holiday — last Monday of May.'],
            ['name' => 'Juneteenth National Independence Day', 'holiday_date' => self::date($year, 6, 19), 'holiday_type' => 'non_working', 'description' => 'US federal holiday.'],
            ['name' => 'Independence Day', 'holiday_date' => self::date($year, 7, 4), 'holiday_type' => 'non_working', 'description' => 'US federal holiday.'],
            ['name' => 'Labor Day', 'holiday_date' => self::nthWeekday($year, 9, 1, 1), 'holiday_type' => 'non_working', 'description' => 'US federal holiday — 1st Monday of September.'],
            ['name' => 'Columbus Day', 'holiday_date' => self::nthWeekday($year, 10, 1, 2), 'holiday_type' => 'non_working', 'description' => 'US federal holiday — 2nd Monday of October.'],
            ['name' => 'Veterans Day', 'holiday_date' => self::date($year, 11, 11), 'holiday_type' => 'non_working', 'description' => 'US federal holiday.'],
            ['name' => 'Thanksgiving Day', 'holiday_date' => self::nthWeekday($year, 11, 4, 4), 'holiday_type' => 'non_working', 'description' => 'US federal holiday — 4th Thursday of November.'],
            ['name' => 'Christmas Day', 'holiday_date' => self::date($year, 12, 25), 'holiday_type' => 'non_working', 'description' => 'US federal holiday.'],
        ];
    }

    private static function dominicanRepublic($year)
    {
        $goodFriday = clone self::easterDate($year);
        $goodFriday->modify('-2 days');

        return [
            ['name' => 'Año Nuevo (New Year\'s Day)', 'holiday_date' => self::date($year, 1, 1), 'holiday_type' => 'non_working', 'description' => 'Fixed date, not subject to Monday-shift law.'],
            ['name' => 'Día de los Santos Reyes (Epiphany)', 'holiday_date' => self::moveToMondayIfNeeded(self::date($year, 1, 6)), 'holiday_type' => 'non_working', 'description' => 'Observed per Law 139-97 Monday-shift rule.'],
            ['name' => 'Día de la Altagracia', 'holiday_date' => self::date($year, 1, 21), 'holiday_type' => 'non_working', 'description' => 'Fixed date, not subject to Monday-shift law.'],
            ['name' => 'Día de Duarte', 'holiday_date' => self::moveToMondayIfNeeded(self::date($year, 1, 26)), 'holiday_type' => 'non_working', 'description' => 'Observed per Law 139-97 Monday-shift rule.'],
            ['name' => 'Día de la Independencia', 'holiday_date' => self::date($year, 2, 27), 'holiday_type' => 'non_working', 'description' => 'Fixed date, not subject to Monday-shift law.'],
            ['name' => 'Viernes Santo (Good Friday)', 'holiday_date' => $goodFriday->format('Y-m-d'), 'holiday_type' => 'non_working', 'description' => 'Observed on its actual date each year (Easter-dependent).'],
            ['name' => 'Día del Trabajo (Labor Day)', 'holiday_date' => self::moveToMondayIfNeeded(self::date($year, 5, 1)), 'holiday_type' => 'non_working', 'description' => 'Observed per Law 139-97 Monday-shift rule.'],
            ['name' => 'Día de la Restauración', 'holiday_date' => self::moveToMondayIfNeeded(self::date($year, 8, 16)), 'holiday_type' => 'non_working', 'description' => 'Observed per Law 139-97 Monday-shift rule.'],
            ['name' => 'Día de las Mercedes', 'holiday_date' => self::date($year, 9, 24), 'holiday_type' => 'non_working', 'description' => 'Fixed date, not subject to Monday-shift law.'],
            ['name' => 'Día de la Constitución', 'holiday_date' => self::moveToMondayIfNeeded(self::date($year, 11, 6)), 'holiday_type' => 'non_working', 'description' => 'Observed per Law 139-97 Monday-shift rule.'],
            ['name' => 'Navidad (Christmas)', 'holiday_date' => self::date($year, 12, 25), 'holiday_type' => 'non_working', 'description' => 'Fixed date, not subject to Monday-shift law.'],
        ];
    }
}
