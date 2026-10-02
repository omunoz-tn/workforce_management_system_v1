<?php
/**
 * BonusAudit.php
 * The change log behind HR > History: who changed what in the Bonus module, and when.
 *
 * One row per CHANGED FIELD, not per request. Editing a row's team and its amount in one
 * afternoon leaves two entries, each with its own before and after, because that is how the
 * question actually gets asked afterwards -- "who moved her to that team", not "who touched
 * that row". A create and a delete are single entries, since the whole row is the change.
 *
 * Everything is stored DENORMALISED: the employee's name, the user's name, and both values
 * are written as text at the moment it happened. A log that joins its way back to live
 * tables stops being a log the first time somebody is renamed or a row is deleted — it would
 * quietly rewrite history, or lose it. Nothing here has a foreign key for the same reason.
 *
 * Writing a log entry must never be the thing that fails a save. Every call is wrapped so a
 * broken audit table degrades to "no entry" rather than to "the edit did not go through".
 */

/** Creates the table if missing, once per request. */
function ensureBonusAuditTable(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_bonus_audit_log` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          -- The bonus program and month the change belongs to. NULL on a change that is not
          -- about one month, such as a settings change.
          `bonus_type` varchar(64) DEFAULT NULL,
          `period_year` smallint(6) DEFAULT NULL,
          `period_month` tinyint(4) DEFAULT NULL,
          -- The row that changed. Deliberately not a foreign key: the entry has to outlive
          -- the row, and deleting a row is itself one of the things worth logging.
          `bonus_row_id` int(11) DEFAULT NULL,
          `employee_id` bigint(20) DEFAULT NULL,
          `employee_name` varchar(255) DEFAULT NULL,
          -- create | update | delete | setting
          `action` varchar(24) NOT NULL,
          -- Which column, on an update. NULL on the others.
          `field` varchar(48) DEFAULT NULL,
          `old_value` text DEFAULT NULL,
          `new_value` text DEFAULT NULL,
          `user_id` int(11) DEFAULT NULL,
          `user_name` varchar(255) DEFAULT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          PRIMARY KEY (`id`),
          KEY `idx_bonus_audit_recent` (`created_at`),
          KEY `idx_bonus_audit_period` (`period_year`,`period_month`),
          KEY `idx_bonus_audit_employee` (`employee_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");
}

/**
 * Who is making the change, from the session. Falls back to a marked-unknown actor rather
 * than to nothing: an entry with no author is still evidence that something happened.
 *
 * Requires session_start() to have run, which every endpoint that writes here does.
 */
function bonusAuditActor(): array
{
    return [
        'id' => isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null,
        'name' => $_SESSION['full_name'] ?? $_SESSION['username'] ?? 'Unknown user'
    ];
}

/**
 * Writes one entry. Never throws: see the note at the top of this file.
 */
function bonusAuditLog(PDO $pdo, array $entry): void
{
    try {
        ensureBonusAuditTable($pdo);
        $actor = bonusAuditActor();

        $stmt = $pdo->prepare(
            'INSERT INTO org_bonus_audit_log
                (bonus_type, period_year, period_month, bonus_row_id, employee_id,
                 employee_name, action, field, old_value, new_value, user_id, user_name)
             VALUES
                (:bonus_type, :period_year, :period_month, :bonus_row_id, :employee_id,
                 :employee_name, :action, :field, :old_value, :new_value, :user_id, :user_name)'
        );
        $stmt->execute([
            'bonus_type' => $entry['bonus_type'] ?? null,
            'period_year' => $entry['period_year'] ?? null,
            'period_month' => $entry['period_month'] ?? null,
            'bonus_row_id' => $entry['bonus_row_id'] ?? null,
            'employee_id' => $entry['employee_id'] ?? null,
            'employee_name' => $entry['employee_name'] ?? null,
            'action' => $entry['action'],
            'field' => $entry['field'] ?? null,
            'old_value' => $entry['old_value'] ?? null,
            'new_value' => $entry['new_value'] ?? null,
            'user_id' => $actor['id'],
            'user_name' => $actor['name']
        ]);
    } catch (Exception $e) {
        // Swallowed on purpose. A save that succeeded must not be reported as failed
        // because its audit entry could not be written.
        error_log('Bonus audit log write failed: ' . $e->getMessage());
    }
}

/** Writes several entries, for an update that touched more than one field. */
function bonusAuditLogAll(PDO $pdo, array $entries): void
{
    foreach ($entries as $entry) {
        bonusAuditLog($pdo, $entry);
    }
}

/**
 * The columns the log tracks, and what to call them in the history. Anything not listed here
 * is not a user-facing edit — `team_id` changes ride along with `team_name`, for instance,
 * because the reader cares which team, not which id.
 */
function bonusAuditFieldLabels(): array
{
    return [
        'employee_name' => 'Employee Name',
        'team_name' => 'Team',
        'company_name' => 'Company',
        'days_worked' => 'Days Employee Worked',
        'bonus_amount' => 'Bonus Amount',
        'currency' => 'Currency',
        'comments' => 'Comments'
    ];
}

/**
 * The comparable, human-readable form of a bonus row: what the log stores and what the
 * history displays. Values are strings so a diff is a plain !== and so the entry reads the
 * same years later, whatever the ids point at by then.
 */
function bonusAuditSnapshot(PDO $pdo, array $row): array
{
    $companyName = '';
    if (!empty($row['company_id'])) {
        $stmt = $pdo->prepare('SELECT name FROM org_companies WHERE id = :id');
        $stmt->execute(['id' => (int) $row['company_id']]);
        $companyName = (string) ($stmt->fetchColumn() ?: '');
    }

    return [
        'employee_name' => (string) ($row['employee_name'] ?? ''),
        'team_name' => (string) ($row['team_name'] ?? ''),
        'company_name' => $companyName,
        // "auto" rather than an empty string: clearing the override is a real change with a
        // real meaning, and "21 -> (blank)" would not carry it.
        'days_worked' => $row['days_worked_override'] === null
            ? 'auto'
            : (string) (int) $row['days_worked_override'],
        'bonus_amount' => number_format((float) ($row['bonus_amount'] ?? 0), 2, '.', ''),
        'currency' => (string) ($row['currency'] ?? ''),
        'comments' => (string) ($row['comments'] ?? '')
    ];
}

/**
 * One log entry per field that actually moved between two snapshots.
 *
 * `$only` narrows it to the fields the request tried to change, so an edit is never credited
 * with a difference it did not make — a row whose team was renamed elsewhere would otherwise
 * show up as this user's doing.
 */
function bonusAuditDiff(array $before, array $after, array $context, ?array $only = null): array
{
    $entries = [];

    foreach (bonusAuditFieldLabels() as $field => $label) {
        if ($only !== null && !in_array($field, $only, true)) {
            continue;
        }
        if (($before[$field] ?? '') === ($after[$field] ?? '')) {
            continue;
        }

        $entries[] = $context + [
            'action' => 'update',
            'field' => $label,
            'old_value' => $before[$field] ?? '',
            'new_value' => $after[$field] ?? ''
        ];
    }

    return $entries;
}

/** A one-line description of a whole row, for a create or a delete entry. */
function bonusAuditRowSummary(array $snapshot): string
{
    $parts = [
        'Team: ' . ($snapshot['team_name'] !== '' ? $snapshot['team_name'] : '—'),
        'Company: ' . ($snapshot['company_name'] !== '' ? $snapshot['company_name'] : '—'),
        'Bonus: ' . $snapshot['currency'] . ' ' . $snapshot['bonus_amount']
    ];
    if ($snapshot['days_worked'] !== 'auto') {
        $parts[] = 'Days: ' . $snapshot['days_worked'];
    }
    if ($snapshot['comments'] !== '') {
        $parts[] = 'Note: ' . $snapshot['comments'];
    }
    return implode(' · ', $parts);
}
