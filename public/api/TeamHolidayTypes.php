<?php
/**
 * TeamHolidayTypes.php
 * Shared helpers for per-team holiday types, included by manage_team_holiday_types.php
 * (the standalone endpoint) and manage_org.php (which saves them alongside member
 * assignments when the Assign Members modal is submitted).
 *
 * Pure functions only — no output, no dispatch — so it is safe to require anywhere.
 */

const VALID_HOLIDAY_TYPES = ['non_working', 'working', 'campaign_defined'];

/**
 * Replaces a team's override set.
 *
 * Storage is sparse: a value equal to the org-wide default (org_holidays.holiday_type) is
 * dropped rather than stored, so the team keeps inheriting later changes to that default.
 * The one exception is a Custom entry (`campaign_defined`) carrying a time range — that
 * range is team-specific data with nowhere else to live, so the row is kept even when the
 * type itself matches the default.
 *
 * Caller owns the transaction.
 *
 * @param array $types map of holiday_id => 'type' | ['type' => t, 'from' => 'HH:MM', 'to' => 'HH:MM']
 * @return int how many override rows were actually stored
 */
function saveTeamHolidayTypes(PDO $pdo, int $teamId, array $types): int
{
    $pdo->prepare("DELETE FROM org_team_holiday_types WHERE team_id = ?")->execute([$teamId]);

    if (empty($types)) {
        return 0;
    }

    $holidayIds = array_map('intval', array_keys($types));
    $placeholders = implode(',', array_fill(0, count($holidayIds), '?'));
    $stmt = $pdo->prepare("SELECT id, holiday_type FROM org_holidays WHERE id IN ($placeholders)");
    $stmt->execute($holidayIds);
    $defaults = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $defaults[(int) $row['id']] = $row['holiday_type'];
    }

    $insert = $pdo->prepare(
        "INSERT INTO org_team_holiday_types (team_id, holiday_id, holiday_type, exclude_from, exclude_to)
         VALUES (?, ?, ?, ?, ?)"
    );

    $stored = 0;
    foreach ($types as $holidayId => $entry) {
        $holidayId = (int) $holidayId;
        if (!isset($defaults[$holidayId])) {
            continue; // holiday deleted while the modal was open
        }

        [$type, $from, $to] = normalizeHolidayTypeEntry($entry);

        // The range only means anything for Custom; drop it otherwise so a type switch
        // cannot leave a stale window behind that silently keeps discounting hours.
        if ($type !== 'campaign_defined') {
            $from = null;
            $to = null;
        }

        $hasRange = $from !== null && $to !== null;
        if ($defaults[$holidayId] === $type && !$hasRange) {
            continue; // matches the org default and adds nothing: stay inherited
        }

        // Custom without a window behaves exactly like Working, so storing one would be a
        // choice that changes nothing. Checked here rather than in validateTeamHolidayTypes
        // because only this function knows the org defaults, and an inherited Custom with
        // no window is legitimate — it simply stores no row and never reaches this point.
        if ($type === 'campaign_defined' && !$hasRange) {
            throw new InvalidArgumentException(
                'Custom requires a time window: set both a start and an end time.'
            );
        }

        $insert->execute([$teamId, $holidayId, $type, $from, $to]);
        $stored++;
    }

    return $stored;
}

/**
 * Accepts either the plain 'type' shape or the object shape carrying a time range, so a
 * client that never sends ranges keeps working.
 *
 * @return array{0: string, 1: ?string, 2: ?string} type, from, to
 */
function normalizeHolidayTypeEntry($entry): array
{
    if (!is_array($entry)) {
        return [(string) $entry, null, null];
    }
    $type = (string) ($entry['type'] ?? '');
    $from = normalizeTimeOfDay($entry['from'] ?? null);
    $to = normalizeTimeOfDay($entry['to'] ?? null);

    // A half-filled range is meaningless — treat it as no range at all.
    if ($from === null || $to === null) {
        return [$type, null, null];
    }
    return [$type, $from, $to];
}

/** Normalizes 'HH:MM' or 'HH:MM:SS' to 'HH:MM:SS'; anything else becomes null. */
function normalizeTimeOfDay($value): ?string
{
    if (!is_string($value) || $value === '') {
        return null;
    }
    if (preg_match('/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/', $value, $m)) {
        return sprintf('%s:%s:%s', $m[1], $m[2], $m[4] ?? '00');
    }
    return null;
}

/**
 * Rejects anything outside the enum, and any range that does not end after it starts,
 * before it reaches the INSERT — so a bad payload fails as a 400 instead of silently
 * storing a window that excludes nothing (or everything).
 */
function validateTeamHolidayTypes(array $types): void
{
    foreach ($types as $entry) {
        [$type, $from, $to] = normalizeHolidayTypeEntry($entry);

        if (!in_array($type, VALID_HOLIDAY_TYPES, true)) {
            throw new InvalidArgumentException("Invalid holiday type: " . $type);
        }

        // normalizeHolidayTypeEntry discards a half-filled range, which would otherwise
        // reach the database looking like "no window at all". Catch it on the raw input so
        // a dropped end time fails loudly instead of silently disabling the restriction.
        if (is_array($entry)) {
            $rawFrom = ($entry['from'] ?? '') !== '';
            $rawTo = ($entry['to'] ?? '') !== '';
            if ($rawFrom !== $rawTo) {
                throw new InvalidArgumentException(
                    'A time window needs both a start and an end time.'
                );
            }
        }

        if ($from !== null && $to !== null && strtotime($to) <= strtotime($from)) {
            throw new InvalidArgumentException(
                "Invalid time range $from - $to: the end time must be later than the start time."
            );
        }
    }
}
