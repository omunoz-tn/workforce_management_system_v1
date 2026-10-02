<?php
/**
 * BonusSql.php
 * Everything HR > Bonus needs from the database beyond plain CRUD: the table itself, and
 * the two figures the Bonus list fills in on its own for the month being viewed.
 *
 *   Days Employee Worked -- how many days of the month the employee actually earned. A day
 *      counts when the time DeskTime tracked REACHES a fixed number of hours, set in
 *      Configuration > HR > Bonus and defaulting to 7. The same bar for everyone, whatever
 *      shift they are on.
 *   Workdays -- how many working days the month held for that team.
 *
 * Both are DERIVED, never stored: the underlying DeskTime rows keep syncing and holidays
 * keep being edited, so a stored copy would be wrong by the time anybody read it.
 *
 * Workdays is read-only in the UI -- it is a fact about the month and the team's holiday
 * calendar, not about the employee, so there is nothing for a person to correct. Days
 * Employee Worked IS correctable (somebody was on approved leave, a sync missed a day), so
 * the row carries `days_worked_override`: NULL means "use the computed number", which is why
 * it is nullable rather than pre-filled on insert. It can never exceed Workdays -- a bonus
 * cannot be earned on a day the month did not have.
 *
 * The scheduled hours each day is shown against still come from the Run Rate's own window
 * resolution (RunRateWindowSql.php) -- Shift Management's pattern first, DeskTime's window
 * second, the weekday's usual shift last, minus lunch, minus any Custom holiday window. They
 * no longer decide whether the day counted; only the tracked hours do that.
 *
 * Every function here either returns data or SQL; nothing echoes.
 */

require_once __DIR__ . '/RunRateWindowSql.php';
// The Company column is a foreign key into the catalog Configuration > HR > Company owns.
require_once __DIR__ . '/Companies.php';

/**
 * Hours of tracked DeskTime time a day has to reach to count as worked, when nobody has
 * set it. Configuration > HR > Bonus overrides it, and bonusWorkedDayHours() is what every
 * caller should read.
 *
 * This used to be a SHARE of the day's scheduled hours (87.5%), which made the bar move
 * from employee to employee with their shift. An absolute number of hours is the same bar
 * for everyone, which is what the rule was meant to say.
 */
const BONUS_DEFAULT_WORKED_DAY_HOURS = 7;

/** Widest value the setting accepts. A day cannot be longer than this. */
const BONUS_MAX_WORKED_DAY_HOURS = 24;

/** Where the override lives in the platform-wide key/value store. */
const BONUS_WORKED_DAY_HOURS_KEY = 'bonus_worked_day_hours';

/**
 * The configured bar, in hours. Read once per request.
 *
 * Creates platform_settings if it is missing, for the same reason the other ensure guards
 * exist: the Bonus list reads this on every load, and a server that never ran
 * add_platform_settings_table.php would lose the whole screen rather than fall back.
 */
function bonusWorkedDayHours(PDO $pdo): float
{
    static $hours = null;
    if ($hours !== null) {
        return $hours;
    }

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `platform_settings` (
          `setting_key` varchar(64) NOT NULL,
          `setting_value` text DEFAULT NULL,
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`setting_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    $stmt = $pdo->prepare('SELECT setting_value FROM platform_settings WHERE setting_key = :key');
    $stmt->execute(['key' => BONUS_WORKED_DAY_HOURS_KEY]);
    $stored = $stmt->fetchColumn();

    $hours = ($stored !== false && is_numeric($stored) && (float) $stored > 0)
        ? (float) $stored
        : (float) BONUS_DEFAULT_WORKED_DAY_HOURS;

    return $hours;
}

/** Validates a submitted value before it is stored. */
function bonusNormalizeWorkedDayHours($value): float
{
    if (!is_numeric($value)) {
        throw new InvalidArgumentException('Enter the number of hours a worked day has to reach.');
    }
    $hours = round((float) $value, 2);
    if ($hours <= 0 || $hours > BONUS_MAX_WORKED_DAY_HOURS) {
        throw new InvalidArgumentException(
            'Hours must be greater than 0 and no more than ' . BONUS_MAX_WORKED_DAY_HOURS . '.'
        );
    }
    return $hours;
}

/** The card ids under HR > Bonus. Only one program exists so far; the column is sized for more. */
const BONUS_TYPE_HOME_OFFICE = 'home-office-transportation';

/** Currencies a bonus can be denominated in, in the order the modal lists them. */
const BONUS_CURRENCIES = ['DOP', 'USD'];

/** Longest note the Comments column accepts. Guards typos and pastes, not policy. */
const BONUS_MAX_COMMENT_LENGTH = 1000;

/**
 * Creates the table if missing, once per request.
 *
 * add_bonus_tables.php is the migration proper; this guard exists for the same reason
 * ensureOrgEmployeesTable() does -- the screen queries the table on every load, and a
 * missing one would take the whole view down on a server the migration was never run on.
 * CREATE TABLE IF NOT EXISTS against an existing table is a metadata check.
 */
function ensureBonusTables(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    // The CREATE below points a foreign key at org_companies, so that table has to exist
    // first -- on a fresh install neither does yet, and the order they are created in is
    // the only thing that decides whether the constraint can be declared.
    ensureCompaniesTable($pdo);

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_bonus_employees` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          -- Which card under HR > Bonus this row belongs to, so a second program can be
          -- added without a second table.
          `bonus_type` varchar(64) NOT NULL DEFAULT '" . BONUS_TYPE_HOME_OFFICE . "',
          -- The month the bonus is paid for: the month/year the view was showing when the
          -- employee was added. Enrolling somebody in September never touches October.
          `period_year` smallint(6) NOT NULL,
          `period_month` tinyint(4) NOT NULL,
          -- NULL for a name typed by hand (somebody DeskTime does not know). That is also
          -- what keeps the unique key below from rejecting a second manual row: MySQL
          -- treats NULLs in a unique index as distinct.
          `employee_id` bigint(20) DEFAULT NULL,
          -- Stored rather than joined: the column is editable in the List view, and a
          -- manual row has no DeskTime record to read a name from.
          `employee_name` varchar(255) NOT NULL,
          `team_id` int(11) DEFAULT NULL,
          `team_name` varchar(255) DEFAULT NULL,
          -- Which company the employee is paid by. A foreign key, not a name: the catalog
          -- in Configuration > HR > Company is the single spelling of each company, and
          -- ON DELETE SET NULL means retiring one empties the cell rather than leaving a
          -- row pointing at a company that no longer exists.
          `company_id` int(11) DEFAULT NULL,
          -- The cap: what the employee earns for a full month of workdays.
          `bonus_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
          `currency` enum('DOP','USD') NOT NULL DEFAULT 'DOP',
          -- NULL means \"use the computed figure\"; a number here is a manual correction,
          -- capped at the month's Workdays.
          `days_worked_override` int(11) DEFAULT NULL,
          -- Free note per row, shown as its own column in the List view.
          `comments` text DEFAULT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`id`),
          UNIQUE KEY `unique_bonus_employee_period` (`bonus_type`,`period_year`,`period_month`,`employee_id`),
          KEY `idx_bonus_period` (`bonus_type`,`period_year`,`period_month`),
          CONSTRAINT `org_bonus_employees_ibfk_1` FOREIGN KEY (`team_id`)
            REFERENCES `org_teams` (`id`) ON DELETE SET NULL,
          CONSTRAINT `org_bonus_employees_company_fk` FOREIGN KEY (`company_id`)
            REFERENCES `org_companies` (`id`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    // CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so a server
    // that ran the migration before the Comments column existed needs it added here.
    // Cheap enough to check on every request: one metadata lookup, once per process.
    $hasComments = $pdo->query("SHOW COLUMNS FROM org_bonus_employees LIKE 'comments'")->fetch();
    if (!$hasComments) {
        $pdo->exec("ALTER TABLE org_bonus_employees ADD COLUMN `comments` text DEFAULT NULL AFTER `days_worked_override`");
    }

    // Column and constraint go in together: the column being absent is proof the constraint
    // is too, so there is no half-applied state to guard against.
    $hasCompany = $pdo->query("SHOW COLUMNS FROM org_bonus_employees LIKE 'company_id'")->fetch();
    if (!$hasCompany) {
        $pdo->exec("ALTER TABLE org_bonus_employees
                    ADD COLUMN `company_id` int(11) DEFAULT NULL AFTER `team_name`,
                    ADD CONSTRAINT `org_bonus_employees_company_fk` FOREIGN KEY (`company_id`)
                        REFERENCES `org_companies` (`id`) ON DELETE SET NULL");
    }
}

/**
 * First and last day of a period, as YYYY-MM-DD.
 */
function bonusPeriodRange(int $year, int $month): array
{
    $from = sprintf('%04d-%02d-01', $year, $month);
    $to = date('Y-m-t', strtotime($from));
    return [$from, $to];
}

/**
 * Checks a submitted company id against the catalog, so a bad one is a clear message rather
 * than a raw foreign-key violation. NULL is legitimate -- it means no company.
 */
function bonusResolveCompanyId(PDO $pdo, $value): ?int
{
    if ($value === null || $value === '') {
        return null;
    }

    $companyId = (int) $value;
    $stmt = $pdo->prepare('SELECT 1 FROM org_companies WHERE id = :id');
    $stmt->execute(['id' => $companyId]);

    if ($stmt->fetchColumn() === false) {
        throw new InvalidArgumentException('That company is no longer on the list in Configuration > HR > Company.');
    }
    return $companyId;
}

/**
 * The month before the one given, rolling the year back at January.
 */
function bonusPreviousPeriod(int $year, int $month): array
{
    return $month === 1 ? [$year - 1, 12] : [$year, $month - 1];
}

/**
 * One row per (employee, day): the shift that day, the hours it was worth, the hours
 * DeskTime recorded, and the verdict.
 *
 * Written once and used twice — aggregated into a per-employee count by
 * bonusWorkedDaysMap(), and listed day by day by bonusEmployeeDayBreakdown() for the modal
 * that explains the count. Sharing the SQL is what guarantees the explanation adds up to the
 * number.
 *
 * `$extraWhere` is caller-supplied SQL, never request input.
 *
 * The comparison happens per (employee, day) in the subquery and is only then counted, so
 * a strong Monday cannot make up for a short Tuesday -- each day passes or fails alone.
 *
 * Days a holiday makes non-working for the team are dropped entirely rather than counted as
 * failures -- the same rule Workdays applies on the other side of the fraction, so the two
 * numbers always describe the same set of days.
 *
 * The team join is DEDUPLICATED to one team per employee (MIN(team_id), the same pick
 * bonusEmployeeTeamMap makes), unlike get_daily_run_rate.php's plain join. Under the old
 * ratio rule the fan-out an employee on two teams caused was harmless — both sides of the
 * comparison doubled together. Under an absolute bar it is not: doubled tracked hours
 * against a fixed 7 would count a 4-hour day, and the displayed hours would be double too.
 */
function bonusDailySql(float $workedDayHours, string $extraWhere = ''): string
{
    // The employee's own lunch, deducted from the scheduled side WHENEVER the day has a
    // shift — deliberately not rrLunchHours(), which only deducts for teams that switched
    // "Exclude Lunch" on in the Run Rate config. That switch is a reporting decision about
    // the Run Rate; here the scheduled column describes the hours the employee was actually
    // expected to work, and a shift with a lunch in it was never all working hours.
    // Effective rate as everywhere else: the employee's weekday override, else the team's.
    $lunchHours = "CASE WHEN " . rrWindowStart() . " IS NOT NULL"
        . " THEN " . elLunchMinutes() . " / 60.0 ELSE 0 END";

    // Clamped: a shift shorter than its own lunch owes nothing, not negative hours.
    $scheduledNetOfLunch = "GREATEST(0, SUM(" . rrScheduledHours() . ") - SUM($lunchHours))";
    $hours = (float) $workedDayHours;

    return "SELECT d.employee_id,
                   d.log_date,
                   MIN(" . rrWindowStart() . ") AS shift_start,
                   MIN(" . rrWindowEnd() . ") AS shift_end,
                   $scheduledNetOfLunch AS scheduled_hours,
                   SUM($lunchHours) AS lunch_hours,
                   " . rrActualHoursSum() . " AS tracked_hours,
                   -- At or above the bar: seven hours exactly IS a worked day.
                   CASE WHEN " . rrActualHoursSum() . " >= $hours THEN 1 ELSE 0 END AS is_worked_day
            FROM desktime_employee_data d
            LEFT JOIN (
                SELECT employee_id, MIN(team_id) AS team_id
                FROM org_team_assignments
                GROUP BY employee_id
            ) ota ON d.employee_id = ota.employee_id
            LEFT JOIN org_teams ot ON ota.team_id = ot.id
            " . elLunchJoin() . "
            " . rrTimeExceptionJoin() . "
            " . rrCampaignExclusionJoin() . "
            " . rrShiftPatternJoin() . "
            " . rrFallbackScheduleJoin() . "
            WHERE d.log_date BETWEEN :from AND :to
              AND " . rrNonWorkingHolidayFilter() . "
              $extraWhere
            GROUP BY d.employee_id, d.log_date";
}

/**
 * Every scheduled day of one employee's month, with what they were expected to work and what
 * DeskTime recorded — the day-by-day working behind the Days Employee Worked figure.
 *
 * Built on bonusDailySql() rather than on a query of its own, which is the point: a
 * breakdown that could disagree with the number it explains would be worse than no breakdown
 * at all. Count the `is_worked_day` rows here and you get exactly what the column shows.
 *
 * Days with no shift are left out entirely — a Sunday nobody was scheduled for is neither
 * worked nor missed. So are days a holiday makes non-working for the team, dropped by the
 * same filter the count uses.
 */
function bonusEmployeeDayBreakdown(PDO $pdo, int $employeeId, string $from, string $to): array
{
    $stmt = $pdo->prepare(
        "SELECT * FROM ( " . bonusDailySql(bonusWorkedDayHours($pdo), 'AND d.employee_id = :employee_id') . " ) daily
         -- A day the employee was rostered for, or one they tracked time on even though they
         -- were not. The second half matters now that the rule is an absolute number of
         -- hours: an unscheduled Saturday over the bar COUNTS, so it has to be visible here
         -- or the breakdown would not add up to the figure it explains.
         WHERE shift_start IS NOT NULL OR tracked_hours > 0
         ORDER BY log_date"
    );
    $stmt->execute(['from' => $from, 'to' => $to, 'employee_id' => $employeeId]);

    // Tracked hours are floored, not rounded, and that is deliberate. The verdict is decided
    // in SQL against the exact value, so a day of 6.9997 hours does not reach a bar of 7 --
    // but rounding it for display would print "7.00 h" beside a Missed badge and read as a
    // bug. Flooring guarantees the number shown never looks like it should have passed, and
    // never drops a day that did below its own bar.
    return array_map(fn($row) => [
        'log_date' => $row['log_date'],
        'shift_start' => $row['shift_start'],
        'shift_end' => $row['shift_end'],
        'scheduled_hours' => round((float) $row['scheduled_hours'], 2),
        'lunch_hours' => round((float) $row['lunch_hours'], 2),
        'tracked_hours' => floor((float) $row['tracked_hours'] * 100) / 100,
        'worked' => (int) $row['is_worked_day'] === 1
    ], $stmt->fetchAll(PDO::FETCH_ASSOC));
}

function bonusWorkedDaysMap(PDO $pdo, string $from, string $to): array
{
    $sql = "SELECT employee_id, SUM(is_worked_day) AS days_worked
            FROM ( " . bonusDailySql(bonusWorkedDayHours($pdo)) . " ) daily
            GROUP BY employee_id";

    $stmt = $pdo->prepare($sql);
    $stmt->execute(['from' => $from, 'to' => $to]);

    $map = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $map[(int) $row['employee_id']] = (int) $row['days_worked'];
    }
    return $map;
}

/**
 * One month's rows, exactly as HR > Bonus draws them: every stored column plus the figures
 * the module derives -- Days Employee Worked, Workdays, and the earned amount.
 *
 * Lifted out of manage_bonus.php's GET handler so the approval endpoint reads the SAME rows
 * the screen does. Two copies of this arithmetic would be two answers to "what is being
 * approved", and the one that reached Finance would be the copy nobody was looking at.
 *
 * `$scopeFilter` is the caller's team-visibility clause. The list passes one so a
 * team-scoped role sees only its own people; approval passes none, because approving a
 * month means approving the month, not the part of it one role happens to be allowed to
 * read.
 */
function bonusMonthRows(PDO $pdo, string $bonusType, int $year, int $month, string $scopeFilter = ''): array
{
    [$from, $to] = bonusPeriodRange($year, $month);

    $stmt = $pdo->prepare(
        "SELECT b.id, b.bonus_type, b.period_year, b.period_month,
                b.employee_id, b.employee_name,
                oe.name AS assigned_employee_name,
                b.team_id, COALESCE(ot.name, b.team_name) AS team_name,
                b.company_id, oc.name AS company_name,
                b.bonus_amount, b.currency,
                b.days_worked_override, b.comments
         FROM org_bonus_employees b
         LEFT JOIN org_teams ot ON ot.id = b.team_id
         LEFT JOIN org_companies oc ON oc.id = b.company_id
         LEFT JOIN org_employees oe ON oe.employee_id = b.employee_id
         WHERE b.bonus_type = :bonus_type
           AND b.period_year = :year
           AND b.period_month = :month
           $scopeFilter
         ORDER BY COALESCE(ot.name, b.team_name) IS NULL, COALESCE(ot.name, b.team_name), b.employee_name"
    );
    $stmt->execute(['bonus_type' => $bonusType, 'year' => $year, 'month' => $month]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $workedDays = bonusWorkedDaysMap($pdo, $from, $to);
    $workdays = bonusWorkdays($pdo, $from, $to);
    $employeeTeams = bonusEmployeeTeamMap($pdo, array_column($rows, 'employee_id'));

    $data = array_map(function ($row) use ($workedDays, $workdays, $employeeTeams) {
        $employeeId = $row['employee_id'] === null ? null : (int) $row['employee_id'];
        $teamId = $row['team_id'] === null ? null : (int) $row['team_id'];

        // A name typed by hand has no DeskTime history to count days from, so its
        // computed figure is 0 and the column is there to be filled in manually.
        $daysWorkedAuto = $employeeId !== null ? ($workedDays[$employeeId] ?? 0) : 0;

        // What the platform says this employee's team is, whatever the row was edited to.
        // The Team column's equivalent of days_worked_auto: the value its reset puts back.
        $assigned = $employeeId !== null ? ($employeeTeams[$employeeId] ?? null) : null;

        // Whose holiday calendar Workdays is counted against: the row's own team, or --
        // once the Team cell has been typed over and the link dropped -- the assignment
        // above, which is the one their worked days were already measured against.
        $holidayTeamId = $teamId ?? ($assigned['team_id'] ?? null);
        $workdaysAuto = ($holidayTeamId !== null && isset($workdays['by_team'][$holidayTeamId]))
            ? $workdays['by_team'][$holidayTeamId]
            : $workdays['default'];

        // Clamped on the way out as well as on the way in: the month's Workdays can drop
        // after the fact (a holiday added later), which would otherwise leave a stored
        // override paying for days the month no longer has.
        $daysWorked = $row['days_worked_override'] !== null
            ? min((int) $row['days_worked_override'], $workdaysAuto)
            : $daysWorkedAuto;
        $amount = (float) $row['bonus_amount'];

        return [
            'id' => (int) $row['id'],
            'bonus_type' => $row['bonus_type'],
            'period_year' => (int) $row['period_year'],
            'period_month' => (int) $row['period_month'],
            'employee_id' => $employeeId,
            'employee_name' => $row['employee_name'],
            // What DeskTime calls this person -- the Employee Name column's own
            // equivalent of days_worked_auto and assigned_team_name. Empty for a
            // manual row: no record, nothing to compare against or go back to.
            'assigned_employee_name' => $row['assigned_employee_name'] ?? '',
            'team_id' => $teamId,
            'team_name' => $row['team_name'] ?? '',
            'assigned_team_id' => $assigned['team_id'] ?? null,
            'assigned_team_name' => $assigned['team_name'] ?? '',
            'company_id' => $row['company_id'] === null ? null : (int) $row['company_id'],
            'company_name' => $row['company_name'] ?? '',
            'bonus_amount' => $amount,
            'currency' => $row['currency'],
            'comments' => $row['comments'] ?? '',
            'days_worked' => $daysWorked,
            'days_worked_auto' => $daysWorkedAuto,
            'days_worked_override' => $row['days_worked_override'] === null ? null : (int) $row['days_worked_override'],
            'workdays' => $workdaysAuto,
            'total_earned' => bonusEarnedAmount($amount, $daysWorked, $workdaysAuto)
        ];
    }, $rows);

    return $data;
}

/**
 * How many working days the range holds, as ['default' => int, 'by_team' => [team_id => int]].
 *
 * Monday to Friday, less the days a holiday makes non-working. Which holidays those are is
 * a per-team question -- Employees > Teams > Holidays lets a team override the
 * organization-wide type -- so `by_team` carries an entry for every team that has any
 * override in the range; a team absent from it has none and takes `default`.
 *
 * A date carrying two holidays (two countries can share one) is out if EITHER resolves to
 * non_working for the team, which is the rule rrNonWorkingHolidayFilter() enforces in SQL.
 */
function bonusWorkdays(PDO $pdo, string $from, string $to): array
{
    $businessDays = [];
    $cursor = new DateTime($from);
    $end = new DateTime($to);
    while ($cursor <= $end) {
        if ((int) $cursor->format('N') <= 5) {
            $businessDays[$cursor->format('Y-m-d')] = true;
        }
        $cursor->modify('+1 day');
    }

    $stmt = $pdo->prepare(
        "SELECT oh.id AS holiday_id,
                oh.holiday_date,
                oh.holiday_type AS default_type,
                tht.team_id,
                tht.holiday_type AS team_type
         FROM org_holidays oh
         LEFT JOIN org_team_holiday_types tht ON tht.holiday_id = oh.id
         WHERE oh.holiday_date BETWEEN :from AND :to"
    );
    $stmt->execute(['from' => $from, 'to' => $to]);

    // One entry per holiday, carrying the org default plus whichever teams disagree with it.
    $holidays = [];
    $overridingTeams = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $holidayId = (int) $row['holiday_id'];
        if (!isset($holidays[$holidayId])) {
            $holidays[$holidayId] = [
                'date' => substr((string) $row['holiday_date'], 0, 10),
                'default' => $row['default_type'],
                'overrides' => []
            ];
        }
        if ($row['team_id'] !== null) {
            $teamId = (int) $row['team_id'];
            $holidays[$holidayId]['overrides'][$teamId] = $row['team_type'];
            $overridingTeams[$teamId] = true;
        }
    }

    $countFor = function (?int $teamId) use ($holidays, $businessDays) {
        $lost = [];
        foreach ($holidays as $holiday) {
            if (!isset($businessDays[$holiday['date']])) {
                continue; // A holiday on a weekend costs nobody a workday.
            }
            $type = ($teamId !== null && isset($holiday['overrides'][$teamId]))
                ? $holiday['overrides'][$teamId]
                : $holiday['default'];
            if ($type === 'non_working') {
                $lost[$holiday['date']] = true;
            }
        }
        return count($businessDays) - count($lost);
    };

    $byTeam = [];
    foreach (array_keys($overridingTeams) as $teamId) {
        $byTeam[$teamId] = $countFor($teamId);
    }

    return ['default' => $countFor(null), 'by_team' => $byTeam];
}

/**
 * employee_id => team_id, for the employees given.
 *
 * Which team's holidays a row's Workdays is counted against. A row normally carries its own
 * team_id, but editing the Team cell clears it (the text becomes a label, not a link), and
 * the employee is still on whatever team org_team_assignments says — the same team the
 * worked-day count is already measured against. Reading it here keeps the two halves of the
 * fraction describing the same set of days after such an edit.
 *
 * LIMIT-free and grouped: MIN() picks one deterministically for the handful of people
 * assigned to two teams, matching the id manage_bonus.php stores on insert.
 */
function bonusEmployeeTeamMap(PDO $pdo, array $employeeIds): array
{
    $ids = array_values(array_unique(array_map('intval', array_filter($employeeIds, 'is_numeric'))));
    if (empty($ids)) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    // The name rides along because the Team column offers a way back to this value, and a
    // reset has to show what it is reverting to before the round trip that applies it.
    $stmt = $pdo->prepare(
        "SELECT ota.employee_id, MIN(ota.team_id) AS team_id,
                MIN(ot.name) AS team_name
         FROM org_team_assignments ota
         LEFT JOIN org_teams ot ON ot.id = ota.team_id
         WHERE ota.employee_id IN ($placeholders)
         GROUP BY ota.employee_id"
    );
    $stmt->execute($ids);

    $map = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $map[(int) $row['employee_id']] = [
            'team_id' => (int) $row['team_id'],
            'team_name' => $row['team_name'] ?? ''
        ];
    }
    return $map;
}

/**
 * The row already holding this person in that month, or NULL when there is none.
 *
 * One person, one row per month — even when they sit on two teams, and even when one of the
 * two rows was typed by hand. The unique key on (bonus_type, year, month, employee_id)
 * cannot enforce that on its own: MySQL treats NULLs in a unique index as distinct, so a
 * manual "Ana Muñoz" and the DeskTime Ana Muñoz slide past it as different rows. This is the
 * check that closes it, and manage_bonus.php runs it on every insert and on every edit that
 * changes who a row is about.
 *
 * Two rules, not one:
 *   - Same employee_id is always a duplicate. That is what stops an employee on two teams
 *     from being added once per team, which is how the roster's team join presents them.
 *   - Same NAME is a duplicate only when one of the two sides is manual. Two different
 *     DeskTime employees who happen to share a name are two people, and both are entitled
 *     to a bonus; a typed name matching a linked one is the same person entered twice.
 *
 * The name comparison rides on the column's utf8mb4_general_ci collation, which already
 * ignores case and accents — "ana munoz" finds "Ana Muñoz" without any normalising here.
 *
 * `$excludeId` is the row being edited, which must not count as its own duplicate.
 */
function bonusFindDuplicate(
    PDO $pdo,
    string $bonusType,
    int $year,
    int $month,
    ?int $employeeId,
    string $employeeName,
    ?int $excludeId = null
): ?array {
    $stmt = $pdo->prepare(
        "SELECT id, employee_id, employee_name, team_name
         FROM org_bonus_employees
         WHERE bonus_type = :bonus_type
           AND period_year = :year
           AND period_month = :month
           AND (:exclude_id IS NULL OR id <> :exclude_id)
           AND (
               (:employee_id IS NOT NULL AND employee_id = :employee_id)
               OR
               (employee_name = :employee_name AND (employee_id IS NULL OR :employee_id IS NULL))
           )
         LIMIT 1"
    );
    $stmt->execute([
        'bonus_type' => $bonusType,
        'year' => $year,
        'month' => $month,
        'exclude_id' => $excludeId,
        'employee_id' => $employeeId,
        'employee_name' => $employeeName
    ]);

    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row === false ? null : $row;
}

/**
 * The kind of name clash bonusFindDuplicate() deliberately lets pass: another row in the
 * month SHOWING the same name while both rows carry their own, different DeskTime ids.
 *
 * At creation that pair is legitimate — two real people can share a name, and the ID column
 * is what tells them apart. But an EDIT landing on it is usually somebody typing over the
 * wrong row, so manage_bonus.php answers this one with a warning the user must confirm
 * rather than with silence or a wall. Same collation-driven comparison as everywhere else:
 * "mery michel" finds "Mery Michel".
 *
 * `$excludeId` is the row being edited; re-saving a row's own name is not a clash.
 */
function bonusFindNameCollision(
    PDO $pdo,
    string $bonusType,
    int $year,
    int $month,
    string $employeeName,
    ?int $excludeId = null
): ?array {
    $stmt = $pdo->prepare(
        "SELECT b.id, b.employee_id, b.employee_name,
                COALESCE(ot.name, b.team_name) AS team_name
         FROM org_bonus_employees b
         LEFT JOIN org_teams ot ON ot.id = b.team_id
         WHERE b.bonus_type = :bonus_type
           AND b.period_year = :year
           AND b.period_month = :month
           AND b.employee_name = :employee_name
           AND (:exclude_id IS NULL OR b.id <> :exclude_id)
         LIMIT 1"
    );
    $stmt->execute([
        'bonus_type' => $bonusType,
        'year' => $year,
        'month' => $month,
        'employee_name' => $employeeName,
        'exclude_id' => $excludeId
    ]);

    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row === false ? null : $row;
}

/**
 * What the employee earned: the day rate (the cap spread over the month's workdays) times
 * the days they worked, and never more than the cap itself -- Bonus Amount is the ceiling
 * the employee can reach, so a month where the worked days somehow outrun the workdays
 * (an override typed too high, an employee who worked a non-working holiday) still pays the
 * full bonus and no more.
 */
function bonusEarnedAmount(float $bonusAmount, int $daysWorked, int $workdays): float
{
    if ($workdays <= 0 || $daysWorked <= 0) {
        return 0.0;
    }
    return round(min($bonusAmount, $daysWorked * ($bonusAmount / $workdays)), 2);
}
