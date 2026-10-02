<?php
/**
 * EmployeeRoster.php
 * The employee master record: one row per person DeskTime has ever reported, kept in
 * `org_employees`.
 *
 * Before this table existed, `desktime_employee_data` answered two different questions at
 * once -- "what happened on this day" (a fact table) and "who is an employee, what are they
 * called, which group are they in" (a dimension). It is fed from an API that only knows the
 * CURRENT roster, so the second question silently decayed into "who is here today": someone
 * taken out of DeskTime kept their daily rows but stopped existing as a person, and any
 * screen that started from the roster rather than from a date range lost them.
 *
 * This table is derived data -- every column can be rebuilt from desktime_employee_data --
 * so it is safe to drop and backfill again. What it adds is a stable identity with an
 * employment window (`first_seen` .. `last_seen`) that outlives the API's memory.
 *
 * Active/inactive is deliberately NOT a stored column. A flag has to be maintained and
 * drifts the moment someone forgets to; a pair of dates cannot go stale. Everything that
 * needs the distinction derives it from `last_seen` through the one threshold below.
 */

/**
 * How many days behind the newest data an employee may fall before the roster stops
 * treating them as current. Three days absorbs a weekend plus a late sync.
 *
 * The only place this number is written down. It governs the projection roster on the
 * Schedule Board (who a future shift may be forecast onto) -- not who appears in a
 * historical range, which is answered by the employment window instead.
 */
const EMPLOYEE_ACTIVE_WINDOW_DAYS = 3;

/**
 * Creates the table if missing and fills it from the history already on disk, once per
 * request.
 *
 * add_org_employees_table.php is the migration proper. This guard exists for the same
 * reason ensureAbsenteeismExceptionTables() does: the endpoints join the table on every
 * load, and a missing one would take a whole screen down instead of degrading it. CREATE
 * TABLE IF NOT EXISTS against an existing table is a metadata check, and the backfill only
 * runs while the table is empty, so the normal path costs one COUNT.
 */
function ensureOrgEmployeesTable(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    // employee_id is bigint to match org_absenteeism_excluded_employees, the most recently
    // added table to key on it. DeskTime ids are small enough that int(11) has held so far.
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_employees` (
          `employee_id` bigint(20) NOT NULL,
          `name` varchar(255) NOT NULL,
          `email` varchar(255) DEFAULT NULL,
          -- Last DeskTime group seen, kept because it is the team name every report falls
          -- back to when an employee has no org_team_assignments row.
          `group_name` varchar(255) DEFAULT NULL,
          `api_account` varchar(50) DEFAULT NULL,
          `first_seen` date NOT NULL,
          `last_seen` date NOT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`employee_id`),
          -- The employment-window overlap test below is the only non-key lookup.
          KEY `idx_employment_window` (`last_seen`,`first_seen`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    if ((int) $pdo->query("SELECT COUNT(*) FROM org_employees")->fetchColumn() === 0) {
        backfillOrgEmployees($pdo);
    }
}

/**
 * Rebuilds every row from desktime_employee_data. Safe to re-run: existing rows are updated
 * in place rather than duplicated, and the window can only widen.
 *
 * Identity fields come from the employee's most recent day, so a rename or a group move
 * lands. The GROUP BY collapses the case where one person has rows under two api_accounts
 * on the same date, which the unique key on desktime_employee_data allows.
 *
 * @return int rows written
 */
function backfillOrgEmployees(PDO $pdo): int
{
    $sql = "INSERT INTO org_employees
                (employee_id, name, email, group_name, api_account, first_seen, last_seen)
            SELECT w.employee_id,
                   MIN(d.name),
                   MIN(d.email),
                   MIN(d.group_name),
                   MIN(d.api_account),
                   w.first_seen,
                   w.last_seen
            FROM (
                SELECT employee_id, MIN(log_date) AS first_seen, MAX(log_date) AS last_seen
                FROM desktime_employee_data
                GROUP BY employee_id
            ) w
            INNER JOIN desktime_employee_data d
                    ON d.employee_id = w.employee_id AND d.log_date = w.last_seen
            GROUP BY w.employee_id, w.first_seen, w.last_seen
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                email = VALUES(email),
                group_name = VALUES(group_name),
                api_account = VALUES(api_account),
                first_seen = LEAST(first_seen, VALUES(first_seen)),
                last_seen = GREATEST(last_seen, VALUES(last_seen))";

    return $pdo->exec($sql);
}

/**
 * The upsert the sync runs for each employee it receives, alongside the daily row.
 *
 * Placeholders, in order: employee_id, name, email, group_name, api_account, log_date,
 * log_date -- the last two are both ends of the window on a first sighting.
 *
 * The window only ever widens: LEAST/GREATEST mean back-syncing an old date extends
 * `first_seen` without pretending the person left, and re-syncing a date in the middle of
 * their history moves neither end.
 */
function orgEmployeeUpsertSql(): string
{
    return "INSERT INTO org_employees
                (employee_id, name, email, group_name, api_account, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                -- Identity is only refreshed by a sync at or after the newest day on
                -- record, so back-syncing an old date cannot revive a stale name or group.
                name = IF(VALUES(last_seen) >= last_seen, VALUES(name), name),
                email = IF(VALUES(last_seen) >= last_seen, VALUES(email), email),
                group_name = IF(VALUES(last_seen) >= last_seen, VALUES(group_name), group_name),
                api_account = IF(VALUES(last_seen) >= last_seen, VALUES(api_account), api_account),
                first_seen = LEAST(first_seen, VALUES(first_seen)),
                last_seen = GREATEST(last_seen, VALUES(last_seen))";
}

/**
 * Employees whose employment window overlaps [:rosterFrom, :rosterTo] -- the roster as it
 * stood during that period, ex-employees included.
 *
 * Overlap rather than "had a row inside the range" on purpose: someone on leave for a whole
 * month still belonged to the roster that month, and the board should show their days as
 * OFF rather than omit the person.
 */
function orgEmployeeInRangeFilter(string $alias = 'oe'): string
{
    return "$alias.last_seen >= :rosterFrom AND $alias.first_seen <= :rosterTo";
}

/**
 * Wraps a roster text column so both halves of the in-range UNION agree on a collation.
 *
 * org_employees is utf8mb4_general_ci (this file's own CREATE TABLE) while
 * desktime_employee_data is utf8mb4_unicode_ci -- older, and not this module's to restack.
 * MariaDB will not UNION two columns whose collations differ and neither side is explicit:
 * "Illegal mix of collations for operation 'UNION'". Naming one on BOTH sides settles it
 * with no migration and no table rewrite.
 *
 * CONVERT comes first so the COLLATE cannot itself be invalid: applying a utf8mb4 collation
 * to a utf8mb3 column is an error, and this way a column that is not utf8mb4 today still
 * lands somewhere legal. The explicit collation also outranks any column's own, which is
 * what keeps the COALESCE against org_teams.name in the caller safe whatever that table is.
 */
function rosterTextExpr(string $expr): string
{
    return "CONVERT($expr USING utf8mb4) COLLATE utf8mb4_general_ci";
}

/**
 * The other half of the in-range roster: anyone with at least one WORKED day inside
 * [:workedFrom, :workedTo], read straight from `desktime_employee_data`.
 *
 * org_employees is derived data, and the overlap test above is only as good as the window
 * stored in it -- a row that was never written, or whose `last_seen` never caught up,
 * silently removes a person from every picker that starts from the roster. The fact table
 * has no such failure mode: it holds one row per person per day for as long as the history
 * goes back, and a day with tracked time on it is proof the person was working.
 *
 * That makes this branch the guarantee, not an optimisation: if somebody was let go in
 * August and has a single August day with hours, August's roster contains them whatever
 * org_employees says. Anyone the overlap test ALREADY returns is excluded here, so the two
 * branches are disjoint and UNION ALL cannot produce a person twice.
 *
 * Either time column counts. Which one a team measures by is a per-team setting
 * (run_rate_time_source), and membership is not the place to care -- the question here is
 * "was this person working", not "how much did they work".
 */
function orgEmployeeWorkedInRangeSql(string $employeeFilter = ''): string
{
    $name = rosterTextExpr('MIN(d.name)');
    $group = rosterTextExpr('MIN(d.group_name)');

    return "SELECT d.employee_id,
                   $name AS name,
                   $group AS group_name
            FROM desktime_employee_data d
            WHERE d.log_date BETWEEN :workedFrom AND :workedTo
              AND (COALESCE(d.desktime_time, 0) > 0 OR COALESCE(d.at_work_time, 0) > 0)
              $employeeFilter
              AND NOT EXISTS (
                  SELECT 1 FROM org_employees oe2
                  WHERE oe2.employee_id = d.employee_id
                    AND oe2.last_seen >= :workedFrom
                    AND oe2.first_seen <= :workedTo
              )
            GROUP BY d.employee_id";
}

/**
 * Employees still current: within EMPLOYEE_ACTIVE_WINDOW_DAYS of the newest data in the
 * table. This is the roster a future shift may be projected onto.
 *
 * Measured against the newest log_date rather than CURDATE() so a sync that has not run yet
 * today does not empty the roster.
 */
function orgEmployeeCurrentFilter(string $alias = 'oe'): string
{
    return "$alias.last_seen >= (
                SELECT DATE_SUB(MAX(log_date), INTERVAL " . EMPLOYEE_ACTIVE_WINDOW_DAYS . " DAY)
                FROM desktime_employee_data
            )";
}
