<?php
/**
 * AbsenteeismExceptionsSql.php
 * SQL fragments and table bootstrap for the Absenteeism Report's exceptions
 * (Configuration > Reports > Advance Configuration > Absenteeism Report >
 * Exceptions).
 *
 * These mirror the Run Rate exceptions in shape but live in their own tables,
 * so excusing a day or an employee here changes the Absenteeism Report and
 * nothing else — Run Rate, the Dashboard cards and every other report keep
 * reading their own configuration.
 *
 * Three kinds, matching the modal's tabs:
 *
 *   - Days Exceptions / Team     -> org_absenteeism_excluded_days
 *     a date the whole team is excused for (a holiday, an office closure).
 *   - Days Exceptions / Employee -> org_absenteeism_excluded_employee_days
 *     a date one employee is excused for (approved leave), their team unaffected.
 *   - Employees Exceptions       -> org_absenteeism_excluded_employees
 *     an employee who never counts, on any date.
 *
 * An excused row is dropped entirely, not just from the absence count: it stops
 * being a scheduled shift too. That keeps the rate honest — excusing a day the
 * team did not work must not read as a day they all showed up for.
 *
 * Every function returns a SQL string; only ensureAbsenteeismExceptionTables()
 * touches the database.
 */

/**
 * Creates the three tables if they are missing, once per request.
 *
 * add_absenteeism_exceptions_tables.php is the migration proper, but the report
 * joins these tables on every load and a missing one would take the whole report
 * down rather than degrade it. CREATE TABLE IF NOT EXISTS against an existing
 * table is a metadata check, so the guard costs nothing on the normal path.
 */
function ensureAbsenteeismExceptionTables(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    // employee_id is bigint to match desktime_employee_data.employee_id and
    // org_team_assignments.employee_id. The equivalent Run Rate tables declare it
    // int(11), which holds only because DeskTime ids happen to be small today.
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_absenteeism_excluded_days` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          `team_id` int(11) NOT NULL,
          `excluded_date` date NOT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          PRIMARY KEY (`id`),
          UNIQUE KEY `unique_team_date` (`team_id`,`excluded_date`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_absenteeism_excluded_employees` (
          `employee_id` bigint(20) NOT NULL,
          `excluded_at` timestamp NULL DEFAULT current_timestamp(),
          PRIMARY KEY (`employee_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_absenteeism_excluded_employee_days` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          `employee_id` bigint(20) NOT NULL,
          `excluded_date` date NOT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          PRIMARY KEY (`id`),
          UNIQUE KEY `unique_employee_date` (`employee_id`,`excluded_date`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");
}

/**
 * The three LEFT JOINs. Expects `d` (desktime_employee_data) and `ota`
 * (org_team_assignments) to already be in the FROM clause, which every
 * absenteeism query has.
 */
function absExceptionJoins(): string
{
    return "
    LEFT JOIN org_absenteeism_excluded_employees abx ON abx.employee_id = d.employee_id
    LEFT JOIN org_absenteeism_excluded_days abd ON abd.team_id = ota.team_id AND abd.excluded_date = d.log_date
    LEFT JOIN org_absenteeism_excluded_employee_days abd_emp ON abd_emp.employee_id = d.employee_id AND abd_emp.excluded_date = d.log_date";
}

/** The matching WHERE clause — keeps only rows no exception applies to. */
function absExceptionFilter(): string
{
    return "
    AND abx.employee_id IS NULL
    AND abd.id IS NULL
    AND abd_emp.id IS NULL";
}
