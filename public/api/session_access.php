<?php
/**
 * session_access.php
 *
 * Single source of truth for "what is this session allowed to see". Every endpoint
 * used to inline the same three lines, which is how two bugs ended up spread across
 * ten files: authorization keyed off the role NAME, and an empty team list was read
 * as "no restriction" instead of "no access".
 *
 * Call these only after session_start().
 */

/**
 * Sessions opened before is_system existed carry no is_admin flag; fall back to the
 * old name check so a deploy does not lock anybody out mid-session. auth.php's
 * session check refreshes the flag on the next poll.
 */
function current_is_admin() {
    if (isset($_SESSION['is_admin'])) {
        return (bool) $_SESSION['is_admin'];
    }
    return ($_SESSION['role_name'] ?? '') === 'Admin';
}

/** 'all' = every team, 'selected' = only the teams assigned to the role. */
function current_team_scope() {
    if (isset($_SESSION['team_scope'])) {
        return $_SESSION['team_scope'] === 'all' ? 'all' : 'selected';
    }
    // Legacy sessions: an empty team list used to mean unrestricted.
    return empty($_SESSION['allowed_teams']) ? 'all' : 'selected';
}

function current_allowed_teams() {
    $teams = $_SESSION['allowed_teams'] ?? [];
    if (!is_array($teams)) {
        return [];
    }
    return array_values(array_unique(array_map('intval', $teams)));
}

/** True when results must be narrowed to specific teams. */
function is_team_restricted() {
    return !current_is_admin() && current_team_scope() === 'selected';
}

/**
 * Bare SQL condition (no leading AND) restricting $column to the visible teams.
 * Returns '' when unrestricted, and '1=0' when the role is scoped to specific
 * teams but has none assigned -- that case must yield no rows, and it must never
 * render as `IN ()`, which is a SQL syntax error.
 *
 * $column is always a caller-supplied literal, never request input.
 */
function team_condition_sql($column) {
    if (!is_team_restricted()) {
        return '';
    }
    $teams = current_allowed_teams();
    if (empty($teams)) {
        return '1=0';
    }
    return $column . ' IN (' . implode(',', $teams) . ')';
}

/** Same rule, for tables that reach teams through org_team_assignments. */
function team_condition_employee_sql($employeeColumn = 'employee_id') {
    if (!is_team_restricted()) {
        return '';
    }
    $teams = current_allowed_teams();
    if (empty($teams)) {
        return '1=0';
    }
    return $employeeColumn . ' IN (SELECT employee_id FROM org_team_assignments WHERE team_id IN ('
        . implode(',', $teams) . '))';
}

/** Ready-to-interpolate " AND <condition> " fragment, or '' when unrestricted. */
function team_filter_sql($column) {
    $condition = team_condition_sql($column);
    return $condition === '' ? '' : ' AND ' . $condition . ' ';
}

function team_filter_employee_sql($employeeColumn = 'employee_id') {
    $condition = team_condition_employee_sql($employeeColumn);
    return $condition === '' ? '' : ' AND ' . $condition . ' ';
}
