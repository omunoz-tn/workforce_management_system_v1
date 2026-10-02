<?php
/**
 * Companies.php
 * The list of companies the organization operates as, kept in `org_companies` and edited
 * from Configuration > HR > Company.
 *
 * A lookup table and nothing more: an id and a name. It exists as its own table rather than
 * as a free-text column on whatever needs it because the point is a CLOSED list -- the
 * screens that will consume it (HR > Bonus first) need everyone picking from the same
 * spelling of the same company, which a text box cannot promise.
 *
 * The name is unique. `utf8mb4_general_ci` compares without regard to case or accents, so
 * "Tn Outsourcing" cannot be added alongside "TN Outsourcing", and MySQL rejects the second
 * one before this file has to think about it.
 *
 * Shared rather than living inside manage_companies.php because reading the list is about
 * to be a second screen's business too.
 */

/** Longest company name accepted. Guards typos and pastes, not policy. */
const MAX_COMPANY_NAME_LENGTH = 150;

/**
 * Creates the table if missing, once per request.
 *
 * add_companies_table.php is the migration proper; this guard exists for the same reason
 * ensureBonusTables() does -- the screen queries the table on every load, and a missing one
 * would take the whole view down on a server the migration was never run on. CREATE TABLE
 * IF NOT EXISTS against an existing table is a metadata check.
 */
function ensureCompaniesTable(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_companies` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          `name` varchar(" . MAX_COMPANY_NAME_LENGTH . ") NOT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`id`),
          -- The collation makes this case- and accent-insensitive, which is the whole
          -- point: one company, one spelling.
          UNIQUE KEY `unique_company_name` (`name`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");
}

/** Every company, alphabetically. The order the pickers show them in. */
function fetchCompanies(PDO $pdo): array
{
    ensureCompaniesTable($pdo);

    $stmt = $pdo->query('SELECT id, name FROM org_companies ORDER BY name');
    return array_map(
        fn($row) => ['id' => (int) $row['id'], 'name' => $row['name']],
        $stmt->fetchAll(PDO::FETCH_ASSOC)
    );
}

/**
 * A submitted name, trimmed and checked. Throws rather than returning an error so both the
 * create and the rename path report the same wording.
 */
function normalizeCompanyName($value): string
{
    $name = trim((string) ($value ?? ''));

    if ($name === '') {
        throw new InvalidArgumentException('Enter a company name.');
    }
    if (mb_strlen($name) > MAX_COMPANY_NAME_LENGTH) {
        throw new InvalidArgumentException(
            'A company name cannot be longer than ' . MAX_COMPANY_NAME_LENGTH . ' characters.'
        );
    }
    return $name;
}
