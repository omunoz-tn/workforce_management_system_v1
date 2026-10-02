/**
 * reportPreferences.js
 *
 * `report_preferences` in localStorage is a whitelist of visible report ids. That is a
 * problem for every report added afterwards: its id is not in a whitelist written before
 * it existed, so a brand new report ships hidden for anyone who ever toggled a report in
 * Configuration -> Reports, and looks broken to them.
 *
 * The fix is to record which reports the whitelist was aware of. Anything outside
 * `knownReports` is new and defaults to visible; anything inside it was a deliberate
 * choice and is honoured. Whitelists written before `knownReports` existed fall back to
 * LEGACY_REPORT_IDS -- the exact catalog at that time -- so reports the user had hidden
 * back then stay hidden.
 */

const STORAGE_KEY = 'report_preferences';

// The report catalog as it stood before `knownReports` was introduced. Do not extend
// this list: new reports belong in the catalogs, and are meant to fall outside it.
const LEGACY_REPORT_IDS = [
    'sync-history',
    'employee-hours',
    'coverage',
    'productivity',
    'punctuality',
    'absenteeism',
    'adherence',
    'overtime',
    'total-hours',
    'run-rate',
    'employee-projects',
    'performance-kpi'
];

/** Visible report ids for this user, in catalog order. Everything is visible by default. */
export const loadVisibleReports = (allIds) => {
    let parsed;
    try {
        parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
        return allIds;
    }

    if (!parsed || !Array.isArray(parsed.visibleReports)) return allIds;

    const known = Array.isArray(parsed.knownReports) ? parsed.knownReports : LEGACY_REPORT_IDS;
    return allIds.filter(id => parsed.visibleReports.includes(id) || !known.includes(id));
};

/** Persists the whitelist together with the catalog it was decided against. */
export const saveVisibleReports = (allIds, visibleReports) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        visibleReports,
        knownReports: allIds
    }));
};

/**
 * One team filter shared by every report view, so narrowing to a few teams in one
 * report carries over when the next one is opened. Stored as a plain array of team
 * names; null means "never chosen", which the caller reads as "all teams".
 */
const TEAM_FILTER_KEY = 'stat_report_team_filter';

export const loadTeamFilter = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(TEAM_FILTER_KEY) || 'null');
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

export const saveTeamFilter = (teamsSet) => {
    try {
        localStorage.setItem(TEAM_FILTER_KEY, JSON.stringify(Array.from(teamsSet)));
    } catch {
        // localStorage unavailable (private browsing, quota, etc.) - filter still works this session
    }
};

/**
 * Last view mode picked in a report that offers several. Validated against the views
 * the report currently ships, so a renamed or dropped view falls back instead of
 * leaving the report blank.
 */
export const loadViewMode = (key, validIds, fallback) => {
    try {
        const stored = localStorage.getItem(key);
        return validIds.includes(stored) ? stored : fallback;
    } catch {
        return fallback;
    }
};

export const saveViewMode = (key, viewId) => {
    try {
        localStorage.setItem(key, viewId);
    } catch {
        // Same as above: the choice simply does not survive this session.
    }
};

/**
 * Column sort for a table that offers one, as { key, direction } — or null for "the table's
 * own default order".
 *
 * Sorting is remembered where filters are not, and the difference is deliberate: an order
 * changes how rows are read, while a filter changes which rows exist. Coming back to a
 * screen still sorted by amount is helpful; coming back to one silently hiding two thirds
 * of its rows is a bug report.
 *
 * `validKeys` is checked on the way out, so a renamed or dropped column falls back to the
 * default instead of leaving the table sorted by a field it no longer has.
 */
export const loadSortConfig = (key, validKeys) => {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        if (!parsed || !validKeys.includes(parsed.key)) return null;
        return { key: parsed.key, direction: parsed.direction === 'desc' ? 'desc' : 'asc' };
    } catch {
        return null;
    }
};

/** Persists that choice; null clears it, which is how "no sort" survives a reload. */
export const saveSortConfig = (key, sortConfig) => {
    try {
        if (sortConfig === null) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(sortConfig));
        }
    } catch {
        // localStorage unavailable — the order still works for this session.
    }
};

/**
 * Where the Bonus list keeps its column layout. Exported because two screens touch it: the
 * list writes it, and Configuration > HR > Bonus offers the button that clears it.
 */
export const BONUS_COLUMN_WIDTHS_KEY = 'bonus_home_office_column_widths';

/**
 * Column widths for a resizable table, as { columnId: px } — or null when the user has
 * never dragged one, which the caller reads as "use the built-in defaults".
 *
 * Stored in pixels rather than percentages because that is what the user actually dragged:
 * a percentage would silently re-scale the layout on a different monitor, which is exactly
 * the surprise a remembered layout is supposed to prevent.
 *
 * `validIds` is checked on the way out, so a renamed or dropped column cannot leave a
 * stale entry pinning space for something that no longer renders.
 */
export const loadColumnWidths = (key, validIds) => {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        if (!parsed || typeof parsed !== 'object') return null;

        const widths = {};
        validIds.forEach(id => {
            const width = Number(parsed[id]);
            if (Number.isFinite(width) && width > 0) widths[id] = width;
        });
        return Object.keys(widths).length > 0 ? widths : null;
    } catch {
        return null;
    }
};

/** Persists that layout; null forgets it and hands the table back to its defaults. */
export const saveColumnWidths = (key, widths) => {
    try {
        if (widths === null) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(widths));
        }
    } catch {
        // localStorage unavailable — the layout still holds for this session.
    }
};
