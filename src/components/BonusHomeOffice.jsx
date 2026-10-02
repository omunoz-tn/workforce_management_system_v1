import React, { useEffect, useMemo, useRef, useState } from 'react';
import './StatReportView.css';
import './BonusHomeOffice.css';
import LoadingScreen from './LoadingScreen';
import TeamFilter from './TeamFilter';
import ViewToggle from './ViewToggle';
import BonusCurrencySelect from './BonusCurrencySelect';
import BonusComboCell from './BonusComboCell';
import BonusTeamModal from './BonusTeamModal';
import BonusDaysModal from './BonusDaysModal';
import BonusColumnFilter from './BonusColumnFilter';
import AddBonusEmployeeModal from './AddBonusEmployeeModal';
import ImportBonusListModal from './ImportBonusListModal';
import BonusApprovalModal from './BonusApprovalModal';
import {
    EditableAmountCell,
    EditableDaysCell,
    EditableTextCell
} from './BonusEditableCells';
import {
    BONUS_COLUMN_WIDTHS_KEY,
    loadColumnWidths,
    loadSortConfig,
    loadViewMode,
    saveColumnWidths,
    saveSortConfig,
    saveViewMode
} from '../reportPreferences';
import { fontOf, widestText, widestWord } from '../utils/textWidth';
import { downloadXls } from '../utils/xls';
import { buildBonusXlsTable, bonusXlsFilename } from '../utils/bonusXls';
import { formatDate, parseDate, todayStr } from '../utils/dates';
import { normalizeForSearch } from '../utils/search';
import {
    ACTIONS_COLUMN_WIDTH,
    BONUS_COLUMNS,
    DEFAULT_COLUMN_WIDTHS,
    HEADER_TOOLS_WIDTH,
    MIN_COLUMN_WIDTH,
    NO_COMPANY_LABEL,
    SORTABLE_IDS
} from './bonusColumns';
import {
    compareRows,
    earnedAmount,
    formatApprovalMoment,
    isFilterActive,
    rowMatchesFilter,
    rowMatchesSearch,
    totalsOf
} from '../utils/bonusRows';
import {
    BONUS_CURRENCIES,
    currencyClass,
    currencyOf,
    formatBonusAmount
} from '../utils/currency';

/**
 * HR > Bonus > Bonus Home Office / Transportation.
 *
 * One month at a time. The month/year pickers are not a filter over a larger set — they
 * choose which set exists: adding an employee while September 2026 is showing enrols them
 * for September 2026 and for nothing else, which is what lets an amount differ month to
 * month without rewriting what was already paid.
 *
 * Grid summarises by team and List holds the people, the same split the Run Rate report
 * makes. Only List edits: a Grid card opens a read-only modal, and reaching the editable
 * rows from there takes a deliberate second click. All the editing lives in List, so that
 * is where the view opens; the toggle is remembered per browser after that.
 *
 * Two of the List columns are computed rather than entered. Workdays is read-only — it is a
 * property of the month and the team's holiday calendar, so there is nothing to correct.
 * Days Employee Worked can be corrected, and is stored as an OVERRIDE beside the computed
 * figure: clearing the cell hands the column back to the computation (see BonusSql.php),
 * and it is capped at Workdays on both sides of the wire.
 */

const BONUS_TYPE = 'home-office-transportation';
const VIEW_MODE_KEY = 'bonus_home_office_view_mode';


const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

/** Single-person glyph for the card counts — the app's Users icon, reduced to one. */
const PersonIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
    </svg>
);


const SORT_KEY = 'bonus_home_office_sort';

const BonusHomeOffice = ({ onBack }) => {
    // Today in Santo Domingo, not in the browser's timezone — see utils/dates. A laptop set
    // to Tokyo must still open on the month the rest of the platform calls the current one.
    const today = parseDate(todayStr());
    const currentYear = today.getFullYear();

    // Opens on LAST month, not this one: a bonus is settled once the month it covers is
    // over, so on 2 September the list worth looking at is August's. Day 0 of the current
    // month is the last day of the previous one, which rolls the year back on its own —
    // in January this lands on December of the year before.
    const defaultPeriod = new Date(today.getFullYear(), today.getMonth(), 0, 12);

    const [year, setYear] = useState(defaultPeriod.getFullYear());
    const [month, setMonth] = useState(defaultPeriod.getMonth() + 1);
    const [rows, setRows] = useState([]);
    const [roster, setRoster] = useState([]);
    const [teams, setTeams] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [selectedTeams, setSelectedTeams] = useState(new Set());
    const [viewMode, setViewMode] = useState(() => loadViewMode(VIEW_MODE_KEY, ['list', 'grid'], 'list'));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [search, setSearch] = useState('');
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);
    // The month's approval state, as the server reports it on every load. `locked`
    // is what turns the list read-only; the server refuses the writes either way.
    const [approval, setApproval] = useState(null);
    const [isApprovalOpen, setIsApprovalOpen] = useState(false);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [actionNotice, setActionNotice] = useState(null);
    const [openTeam, setOpenTeam] = useState(null);
    // The row whose day-by-day is on screen, or null.
    const [openDaysRow, setOpenDaysRow] = useState(null);
    // null = both currencies. Set by pressing one of the two total chips, which are the
    // only control for it — so it is cleared whenever they leave the screen.
    const [currencyFilter, setCurrencyFilter] = useState(null);
    // { [columnId]: filterValue }. A column absent from here is unfiltered. Team is not
    // stored here at all — its filter IS `selectedTeams`, see columnFilterFor() below.
    const [columnFilters, setColumnFilters] = useState({});
    // null = the order the server sent (team, then name). Remembered across visits, unlike
    // the filters: an order changes how rows read, a filter changes which rows exist.
    const [sortConfig, setSortConfig] = useState(() => loadSortConfig(SORT_KEY, SORTABLE_IDS));
    // Every column's width in pixels, seeded from the defaults and overlaid with whatever
    // the user last dragged. Always complete, so the render never has to fall back.
    const [columnWidths, setColumnWidths] = useState(() => ({
        ...DEFAULT_COLUMN_WIDTHS,
        ...(loadColumnWidths(BONUS_COLUMN_WIDTHS_KEY, SORTABLE_IDS) ?? {})
    }));
    // A drag fires dozens of setState calls a second; the ref is what the mouseup handler
    // reads to persist, since its closure would otherwise see the width from before the drag.
    const columnWidthsRef = useRef(columnWidths);
    columnWidthsRef.current = columnWidths;
    const tableRef = useRef(null);
    // Raised by the month effect, lowered once the filter has been widened again. Starts
    // raised so the first load lands on All Teams.
    const resetTeamFilter = useRef(true);
    // Every team the filter has already had a chance to show. Anything outside it is new,
    // and new means ticked -- see the reconciling effect below.
    const knownTeams = useRef(new Set());

    // This year and next: a bonus is planned one period ahead at most, and an open-ended
    // list is how data lands in 2031 by mistake. Every January the default period is last
    // December, so the year before joins them — driven by the default rather than by the
    // current selection, so the list does not change shape as the user browses.
    const yearOptions = Array.from(
        new Set([defaultPeriod.getFullYear(), currentYear, currentYear + 1])
    ).sort((a, b) => a - b);
    const periodLabel = `${MONTHS[month - 1]} ${year}`;

    // `silent` skips the full-screen spinner: an inline edit that needs the server to
    // recompute (a new employee, a different team) must not blank the table it happened in.
    const loadMonth = async (targetYear, targetMonth, { silent = false } = {}) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `./api/manage_bonus.php?bonus_type=${BONUS_TYPE}&year=${targetYear}&month=${targetMonth}`
            );
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not load the bonus list.');
            const loaded = json.data || [];
            setRows(loaded);
            setApproval(json.approval ?? null);
            return loaded;
        } catch (err) {
            setError(err.message);
            setRows([]);
            setApproval(null);
            return [];
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        resetTeamFilter.current = true;
        setCurrencyFilter(null);
        setColumnFilters({});
        // Both messages are about the month being left behind.
        setActionNotice(null);
        setActionError(null);
        loadMonth(year, month);
    }, [year, month]);

    // The window the employee pickers must cover, as the roster endpoint's from/to.
    //
    // Without a range that endpoint answers "who is here NOW" — last seen within three days
    // of the newest DeskTime data — and the Bonus month is settled AFTER it ends. Anyone who
    // left during or since the month it covers was therefore missing from "+ Add Employee",
    // even though the month they worked is a month they are owed for; they had to be typed
    // in by hand as manual rows, which is how a real employee ends up on the list with no
    // DeskTime link. With a range, the endpoint answers "who was on the roster during those
    // dates" instead, which is the question this screen is actually asking.
    //
    // The window is stretched to always contain today as well as the bonus month, so it can
    // never offer FEWER people than the old call did: somebody hired since the month closed
    // is still there, and picking a future month cannot empty the list.
    const [rosterFrom, rosterTo] = useMemo(() => {
        const today = parseDate(todayStr());
        const monthStart = new Date(year, month - 1, 1, 12);
        const monthEnd = new Date(year, month, 0, 12);
        return [
            formatDate(monthStart <= today ? monthStart : today),
            formatDate(monthEnd >= today ? monthEnd : today)
        ];
    }, [year, month]);

    // The roster behind both employee pickers. Reloaded when the month moves, because the
    // range above is what decides who counts as being on it.
    useEffect(() => {
        let cancelled = false;
        fetch(`./api/get_schedule_board.php?roster=1&from=${rosterFrom}&to=${rosterTo}`)
            .then(res => res.json())
            .then(json => {
                // A slow answer for a month the user has already moved off would otherwise
                // overwrite the right one.
                if (cancelled || !json.success) return;
                // The roster endpoint joins org_team_assignments, so somebody on two teams
                // comes back twice under one employee_id. Left as-is that is two entries in
                // every picker for one person — which is exactly how the same employee ended
                // up on a bonus list twice. One entry per person; the server resolves which
                // of their teams the row is filed under.
                const seen = new Set();
                const unique = (json.data || []).filter(emp => {
                    if (seen.has(emp.id)) return false;
                    seen.add(emp.id);
                    return true;
                });
                setRoster(unique);
            })
            .catch(err => {
                if (!cancelled) console.error('Failed to load the employee roster', err);
            });
        return () => { cancelled = true; };
    }, [rosterFrom, rosterTo]);

    // The company catalog and the org's teams: neither depends on the month being edited.
    useEffect(() => {
        // The Company column is a picker over this catalog, nothing else — see
        // Configuration > HR > Company.
        fetch('./api/manage_companies.php')
            .then(res => res.json())
            .then(json => { if (json.success) setCompanies(json.data || []); })
            .catch(err => console.error('Failed to load the company list', err));

        fetch('./api/get_org_hierarchy.php')
            .then(res => res.json())
            .then(json => {
                if (!json.success) return;
                const flat = (json.data || []).flatMap(group =>
                    (group.teams || [])
                        .filter(team => Number(team.is_visible) !== 0)
                        .map(team => ({ id: team.id, name: team.name, group: group.name }))
                );
                setTeams(flat.sort((a, b) => a.name.localeCompare(b.name)));
            })
            .catch(err => console.error('Failed to load the team list', err));
    }, []);

    const rosterOptions = useMemo(
        () => roster.map(emp => ({
            key: emp.id,
            label: emp.name,
            sublabel: emp.team || 'No team',
            employee: emp
        })),
        [roster]
    );

    const teamOptions = useMemo(
        () => teams.map(team => ({
            key: team.id,
            label: team.name,
            sublabel: team.group,
            team
        })),
        [teams]
    );

    // Everyone already on this month, so no picker can offer them a second time. The list
    // view's own row is exempt below — a cell has to keep showing the person it holds.
    const enrolledEmployeeIds = useMemo(
        () => new Set(rows.map(row => row.employee_id).filter(id => id !== null)),
        [rows]
    );

    const enrolledNames = useMemo(
        () => new Set(rows.map(row => normalizeForSearch(row.employee_name))),
        [rows]
    );

    // A closed list, plus a way back out of it: without an explicit "no company" row there
    // is no gesture for undoing a company set by mistake, since typing is not accepted here.
    const companyOptions = useMemo(
        () => [
            { key: 'none', label: NO_COMPANY_LABEL, companyId: null },
            ...companies.map(company => ({
                key: company.id,
                label: company.name,
                companyId: company.id
            }))
        ],
        [companies]
    );

    const availableTeams = useMemo(
        () => Array.from(new Set(rows.map(r => r.team_name || 'No team'))).sort(),
        [rows]
    );

    /**
     * Keeps the filter in step with the teams the month actually holds.
     *
     * The rule that matters: a team the filter has NEVER seen starts ticked. Intersecting
     * the new team list with the old selection is not enough — adding the month's first
     * employee from a new team would leave that team unticked, and the row the user just
     * created would be invisible until they went and ticked it by hand. `knownTeams` is
     * what separates "new" from "the user unticked this", the same trick
     * reportPreferences.js plays with knownReports.
     *
     * Opening the screen and picking another month both go back to All Teams: a filter left
     * over from the last visit hides rows nobody expects are there. A reload triggered by an
     * inline edit must NOT reset it — that would throw away a narrowing set on purpose
     * seconds earlier — so the two are told apart by a flag the month effect raises.
     */
    useEffect(() => {
        const known = knownTeams.current;
        const reset = resetTeamFilter.current;

        setSelectedTeams(previous => new Set(
            availableTeams.filter(team => reset || previous.has(team) || !known.has(team))
        ));

        knownTeams.current = new Set(availableTeams);
        resetTeamFilter.current = false;
    }, [availableTeams]);

    // Three stages, and the order matters: the team selection, then the currency chip
    // (`currencyFilteredRows`, shared by both views), then the List's own search, columns
    // and sort. This first one is what the two total chips describe — they deliberately keep
    // counting a currency the screen is currently hiding, because a chip that zeroed itself
    // the moment you pressed it would be both useless and impossible to read your way out of.
    const teamFilteredRows = useMemo(
        () => rows.filter(row => selectedTeams.has(row.team_name || 'No team')),
        [rows, selectedTeams]
    );

    // The choices a checkbox column offers: the values actually present this month, not a
    // catalog. A company nobody is assigned to is not a useful thing to untick.
    const listColumnOptions = useMemo(() => {
        const options = {};
        BONUS_COLUMNS.filter(column => column.type === 'list' && !column.shared).forEach(column => {
            options[column.id] = Array.from(new Set(teamFilteredRows.map(column.value))).sort(
                (a, b) => String(a).localeCompare(String(b))
            );
        });
        return options;
    }, [teamFilteredRows]);

    const optionsFor = (column) => (
        column.shared === 'teams' ? availableTeams : (listColumnOptions[column.id] ?? [])
    );

    /**
     * The filter a column is showing. Team reads straight off `selectedTeams` so its header
     * funnel and the toolbar dropdown are one filter with two controls, never two filters
     * that can disagree.
     */
    const columnFilterFor = (column) => (
        column.shared === 'teams'
            ? { values: Array.from(selectedTeams) }
            : (columnFilters[column.id] ?? null)
    );

    const setColumnFilter = (column, next) => {
        if (column.shared === 'teams') {
            setSelectedTeams(new Set(next.values ?? []));
            return;
        }
        setColumnFilters(current => ({ ...current, [column.id]: next }));
    };

    const clearColumnFilter = (column) => {
        if (column.shared === 'teams') {
            setSelectedTeams(new Set(availableTeams));
            return;
        }
        setColumnFilters(current => {
            const next = { ...current };
            delete next[column.id];
            return next;
        });
    };

    const activeColumns = useMemo(
        () => BONUS_COLUMNS.filter(column => isFilterActive(column, columnFilterFor(column), optionsFor(column))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [columnFilters, selectedTeams, availableTeams, listColumnOptions]
    );

    // The month is frozen. Every editable control below reads this, and every one of those
    // is a courtesy: manage_bonus.php refuses the write regardless (BonusApproval.php).
    const isLocked = approval?.locked === true;

    const searchTokens = useMemo(
        () => normalizeForSearch(search).split(/\s+/).filter(Boolean),
        [search]
    );

    // What the "Reset filters" button counts, and what makes it appear at all. The currency
    // chip and the toolbar search count too: both hide rows exactly as a column filter does,
    // and a row hidden by something the button does not clear is a dead end.
    const activeFilterCount = activeColumns.length
        + (currencyFilter === null ? 0 : 1)
        + (searchTokens.length > 0 ? 1 : 0);

    // The currency chip, applied once for BOTH views rather than inside the List's own
    // pipeline. It is the only filter the Grid has — the column filters need a header row to
    // live in — so pressing "Total US$" narrows the team cards exactly as it narrows the
    // list, and switching views keeps the choice.
    const currencyFilteredRows = useMemo(
        () => (currencyFilter === null
            ? teamFilteredRows
            : teamFilteredRows.filter(row => row.currency === currencyFilter)),
        [teamFilteredRows, currencyFilter]
    );

    // Whether anything at all is hiding rows. Not `listRows.length < rows.length`: a filter
    // that happens to match everything is still on, and a count that stopped saying so would
    // hide the fact that it is there.
    const isFiltered = activeFilterCount > 0;

    // The List's own rows: the team-filtered set, narrowed by the currency chip and by every
    // active column filter (they AND together), then ordered.
    const listRows = useMemo(() => {
        const filtered = currencyFilteredRows.filter(row => {
            if (!rowMatchesSearch(row, searchTokens)) return false;
            return BONUS_COLUMNS.every(column => {
                if (column.shared === 'teams') return true; // already applied upstream
                return rowMatchesFilter(column, columnFilters[column.id] ?? null, row);
            });
        });

        if (sortConfig === null) return filtered;
        const column = BONUS_COLUMNS.find(c => c.id === sortConfig.key);
        if (!column) return filtered;
        return [...filtered].sort(compareRows(column, sortConfig.direction));
    }, [currencyFilteredRows, searchTokens, columnFilters, sortConfig]);

    /**
     * Three states, not two: ascending, descending, then back to the order the server sent.
     * That third click is the sort's own reset, which is why "Reset filters" leaves sorting
     * alone — an order hides nothing, so folding it into a filter reset would surprise.
     */
    const handleSort = (column) => {
        setSortConfig(previous => {
            let next;
            if (previous === null || previous.key !== column.id) {
                next = { key: column.id, direction: column.type === 'number' ? 'desc' : 'asc' };
            } else if (previous.direction === (column.type === 'number' ? 'desc' : 'asc')) {
                next = { key: column.id, direction: column.type === 'number' ? 'asc' : 'desc' };
            } else {
                next = null;
            }
            saveSortConfig(SORT_KEY, next);
            return next;
        });
    };

    /**
     * Drag on a column divider. Listeners go on the document, not the handle, so the pointer
     * can leave the 5px strip mid-drag without the column stopping dead — which is what
     * makes a resize feel attached to the cursor rather than to a target you must stay on.
     */
    const startColumnResize = (column, event) => {
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const startWidth = columnWidthsRef.current[column.id];
        document.body.classList.add('bonus-resizing');

        const onMove = (moveEvent) => {
            const next = Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX);
            setColumnWidths(current => ({ ...current, [column.id]: Math.round(next) }));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.classList.remove('bonus-resizing');
            saveColumnWidths(BONUS_COLUMN_WIDTHS_KEY, columnWidthsRef.current);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    /**
     * Double-click on a divider: size the column to its widest content, the way Excel does.
     *
     * "Widest content" is measured, not guessed — the real font off the live table, every
     * visible row's displayed text (which is not always the stored value: Bonus Amount shows
     * "RD$ 5,000.00", not 5000), and the header's longest word, since a header wraps. Only
     * the ROWS ON SCREEN count, matching Excel: fitting to rows a filter is hiding would
     * size the column for something the user cannot see.
     */
    const autoFitColumn = (column) => {
        // Measured against THIS column's own type, not the table's: the money columns are
        // 0.9rem/800 and the ID is 0.8rem, so one shared font would fit some columns short
        // and others long. The text lives in the cell's input or span, never in the td.
        const index = BONUS_COLUMNS.indexOf(column) + 1;
        const headerCell = tableRef.current?.querySelector(`thead th:nth-child(${index}) .bonus-header-label`);
        const cell = tableRef.current?.querySelector(`tbody tr td:nth-child(${index})`);
        const bodyCell = cell?.querySelector('input, .bonus-earned, .bonus-employee-id') ?? cell;

        const headerWidth = widestWord(column.label, fontOf(headerCell)) + HEADER_TOOLS_WIDTH;
        const bodyWidth = listRows.length === 0
            ? 0
            : widestText(
                listRows.map(row => (column.display ? column.display(row) : String(column.value(row) ?? ''))),
                fontOf(bodyCell)
            );

        // +2 so the widest cell is not left flush against its own edge.
        const fitted = Math.max(MIN_COLUMN_WIDTH, Math.ceil(Math.max(headerWidth, bodyWidth) + column.chrome + 2));
        const next = { ...columnWidthsRef.current, [column.id]: fitted };
        setColumnWidths(next);
        saveColumnWidths(BONUS_COLUMN_WIDTHS_KEY, next);
    };

    // No reset button here: the layout is a per-browser preference, so the way back lives
    // with the other preferences, in Configuration > HR > Bonus.

    /**
     * Every column renders at exactly the pixel width that is stored for it — never a
     * percentage of the table.
     *
     * That distinction is the whole reason dragging works. `.report-table` is width:100%, so
     * a percentage resolves against the WRAPPER, not against the column total: the stored
     * number and the number on screen drift apart, and a drag that adds the mouse delta to
     * the stored one moves the divider by some other amount entirely. The column appears to
     * hit a wall.
     *
     * Fixed pixels make the divider track the cursor 1:1. The space left over on a wide
     * screen goes to a filler column at the end (the only one with no width), which
     * table-layout:fixed hands the remainder to and which collapses to nothing once the
     * columns outgrow the viewport and the wrapper starts scrolling.
     */
    const totalColumnWidth = BONUS_COLUMNS.reduce(
        (total, column) => total + columnWidths[column.id], ACTIONS_COLUMN_WIDTH
    );

    const handleResetFilters = () => {
        setColumnFilters({});
        setCurrencyFilter(null);
        setSearch('');
        setSelectedTeams(new Set(availableTeams));
    };

    /**
     * True when the Team cell no longer matches the employee's assignment — either typed
     * over (team_id cleared) or pointed at a different team. Also true when the assignment
     * itself moved after the row was created, which is worth surfacing rather than hiding:
     * the reset is then a re-sync.
     */
    const nameIsOverridden = (row) => (
        // Exact comparison on purpose: even a changed accent or capital was a hand edit.
        // Manual rows have no DeskTime record, so they are never marked.
        row.employee_id !== null
        && !!row.assigned_employee_name
        && row.employee_name !== row.assigned_employee_name
    );

    const teamIsOverridden = (row) => (
        row.assigned_team_id !== null
        && row.assigned_team_id !== undefined
        && row.team_id !== row.assigned_team_id
    );

    const patchRow = (id, patch) =>
        setRows(current => current.map(row => (row.id === id ? { ...row, ...patch } : row)));

    /**
     * `reload` is for the edits whose consequences the client cannot work out: swapping the
     * employee changes their worked days, moving the row to another team changes the
     * Workdays it is measured against. Everything else patches in place and stays put.
     */
    const saveRow = async (id, payload, { patch = null, reload = false } = {}) => {
        const snapshot = rows;
        if (patch) patchRow(id, patch);
        setActionError(null);

        const send = async (body) => {
            const res = await fetch('./api/manage_bonus.php', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, ...body })
            });
            return res.json();
        };

        try {
            let json = await send(payload);

            // A name another row already shows is a warning, not a wall: the server holds
            // the save until the user has seen WHO already has it. The dialog names them —
            // ID and team — because that ID is what will tell the two rows apart if the
            // user goes ahead, and reading it is what turns a reflex click into a decision.
            if (!json.success && json.needs_confirmation) {
                const other = json.existing || {};
                const who = other.employee_id
                    ? ` (ID ${other.employee_id}${other.team_name ? ` · ${other.team_name}` : ''})`
                    : '';
                const confirmed = window.confirm(
                    `There is already a "${other.employee_name}"${who} on this month's list.

`
                    + 'Keep this name anyway? The list will show two rows with the same name, '
                    + 'told apart only by their ID.'
                );
                if (!confirmed) {
                    // The user backed out: the cell snaps back, and that is not an error.
                    setRows(snapshot);
                    return;
                }
                json = await send({ ...payload, confirm_duplicate_name: true });
            }

            if (!json.success) throw new Error(json.error || 'Could not save the change.');
            if (reload) await loadMonth(year, month, { silent: true });
        } catch (err) {
            setActionError(err.message);
            setRows(snapshot); // Put the cell back to what the server still holds.
        }
    };

    /** The org team whose name matches what DeskTime calls the employee's group, if any. */
    const teamIdForName = (name) => teams.find(team => team.name === name)?.id ?? null;

    /**
     * The duplicate rules, answered from the rows already on screen so the verdict lands
     * the instant Enter is pressed — the server check still runs (another user can have
     * changed the list since it loaded), but nobody waits a round trip to hear about a
     * collision the browser could see for itself.
     *
     * Same matrix as the server: a collision where either side has no DeskTime id is a
     * wall (nothing would tell the rows apart later); two different ids is the warning
     * the user may accept. Returns { ok, confirmed } — `confirmed` rides to the server as
     * the flag, and ONLY when a collision was actually shown, so the server's own check
     * keeps its teeth for collisions this screen could not see.
     */
    const checkNameCollision = (row, name, employeeId) => {
        const normalized = normalizeForSearch(name);
        const other = rows.find(r =>
            r.id !== row.id && normalizeForSearch(r.employee_name) === normalized
        );
        if (!other) return { ok: true, confirmed: false };

        if (other.employee_id === null || employeeId === null) {
            setActionError(
                `${other.employee_name} is already on this month's bonus list. `
                + 'Each employee can only appear once, even across teams.'
            );
            return { ok: false, confirmed: false };
        }

        const ok = window.confirm(
            `There is already a "${other.employee_name}" (ID ${other.employee_id}`
            + `${other.team_name ? ` · ${other.team_name}` : ''}) on this month's list.\n\n`
            + 'Keep this name anyway? The list will show two rows with the same name, '
            + 'told apart only by their ID.'
        );
        return { ok, confirmed: ok };
    };

    // Picking a different person also moves the row to that person's team, which is the
    // whole reason the two columns are linked — the team can still be changed afterwards.
    // Returning false tells the cell to snap back to the name the row still holds.
    const handleEmployeeSelect = (row, option) => {
        const verdict = checkNameCollision(row, option.employee.name, option.employee.id);
        if (!verdict.ok) return false;

        saveRow(row.id, {
            employee_id: option.employee.id,
            employee_name: option.employee.name,
            team_id: teamIdForName(option.employee.team),
            team_name: option.employee.team || '',
            ...(verdict.confirmed ? { confirm_duplicate_name: true } : {})
        }, { reload: true });
    };

    // Typing over the name is a correction, not a different person: the DeskTime link (and
    // with it the worked-day count) stays. Use the dropdown to actually change who this is.
    const handleEmployeeText = (row, name) => {
        if (!name) return false;

        const verdict = checkNameCollision(row, name, row.employee_id);
        if (!verdict.ok) return false;

        saveRow(row.id, {
            employee_name: name,
            ...(verdict.confirmed ? { confirm_duplicate_name: true } : {})
        }, { patch: { employee_name: name } });
    };

    const handleTeamSelect = (row, option) => saveRow(row.id, {
        team_id: option.team.id,
        team_name: option.team.name
    }, { reload: true });

    const handleTeamText = (row, teamName) =>
        saveRow(row.id, { team_name: teamName }, { reload: true });

    const handleCompanyChange = (row, option) =>
        saveRow(row.id, { company_id: option.companyId }, {
            patch: { company_id: option.companyId, company_name: option.companyId === null ? '' : option.label }
        });

    /**
     * Puts the row back on the team the employee is actually assigned to.
     *
     * The Team column's counterpart to clearing a Days override, and the same idea: the
     * platform has an answer of its own (org_team_assignments), the cell may have been
     * edited away from it, and there has to be a way back. Only offered on a row that HAS an
     * assignment to return to — a manual entry has none, so nothing is shown.
     */
    const handleTeamReset = (row) => saveRow(row.id, {
        team_id: row.assigned_team_id,
        team_name: row.assigned_team_name
    }, { reload: true });

    const handleDaysChange = (row, override) => {
        const value = override === null ? row.days_worked_auto : override;
        saveRow(row.id, { days_worked: override }, {
            patch: { days_worked: value, days_worked_override: override }
        });
    };

    const handleAmountChange = (row, amount) =>
        saveRow(row.id, { bonus_amount: amount }, { patch: { bonus_amount: amount } });

    const handleCurrencyChange = (row, currency) =>
        saveRow(row.id, { currency }, { patch: { currency } });

    const handleCommentsChange = (row, comments) =>
        saveRow(row.id, { comments }, { patch: { comments } });

    const handleDelete = async (row) => {
        if (!window.confirm(`Remove ${row.employee_name} from the ${periodLabel} bonus list?`)) return;
        setActionError(null);
        try {
            const res = await fetch(`./api/manage_bonus.php?id=${row.id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not remove the employee.');
            setRows(current => current.filter(r => r.id !== row.id));
        } catch (err) {
            setActionError(err.message);
        }
    };

    const handleAddEmployee = async (employee) => {
        const res = await fetch('./api/manage_bonus.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bonus_type: BONUS_TYPE, year, month, ...employee })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Could not add the employee.');
        setIsAddOpen(false);
        // A reload rather than an append: the new row's Days Worked and Workdays are
        // computed server-side, and this is the only place they come from.
        const loaded = await loadMonth(year, month);

        // The effect above already ticks a team nobody has seen before. This covers the
        // other way a new row can land out of sight: a team that exists and the user had
        // unticked. Read off the saved row rather than off what was submitted, because the
        // server has the last word on which team the row ends up filed under.
        const added = loaded.find(row => row.id === json.id);
        if (added) {
            const team = added.team_name || 'No team';
            setSelectedTeams(previous => (previous.has(team) ? previous : new Set([...previous, team])));
        }
    };

    /**
     * Seeds this month from the previous one. Additive: it brings across who was on the
     * list, their team and their bonus amount, and skips anybody already here — so it is
     * safe to run after having added a few people by hand, and safe to run twice.
     */
    const handleLoadLastMonth = async () => {
        setAddMenuOpen(false);

        const source = new Date(year, month - 2, 1, 12);
        const sourceLabel = `${MONTHS[source.getMonth()]} ${source.getFullYear()}`;

        const confirmed = window.confirm(
            `Copy the ${sourceLabel} bonus list into ${periodLabel}?\n\n`
            + 'Each employee comes across with their team and bonus amount. Days worked and '
            + `the amount earned are recalculated for ${periodLabel}, and anyone already on `
            + 'this list is left untouched.'
        );
        if (!confirmed) return;

        setActionError(null);
        setActionNotice(null);
        try {
            const res = await fetch('./api/manage_bonus.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'copy_previous', bonus_type: BONUS_TYPE, year, month })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not copy the previous month.');

            // A bulk load has to be visible in full, whatever the filter was narrowed to.
            resetTeamFilter.current = true;
            await loadMonth(year, month, { silent: true });

            const from = json.source?.label || sourceLabel;
            setActionNotice(json.copied === 0
                ? (json.skipped > 0
                    ? `Everyone on the ${from} list is already on this one — nothing to copy.`
                    : `The ${from} bonus list is empty — there was nothing to copy.`)
                : `Copied ${json.copied} employee${json.copied === 1 ? '' : 's'} from ${from}.`
                    + (json.skipped > 0 ? ` ${json.skipped} were already on this list and were left alone.` : ''));
        } catch (err) {
            setActionError(err.message);
        }
    };

    /**
     * The list as a styled .xls: navy header band, zebra rows, peso-blue and dollar-green
     * amounts as real formatted numbers, and a total per currency at the foot.
     *
     * Exports exactly what is on screen — team filter, column filters, currency chip and
     * sort included — the same what-you-see rule the Run Rate's CSV export follows. Want
     * the whole month? Reset the filters first; the button's tooltip counts them.
     */
    const handleExport = () => {
        const table = buildBonusXlsTable({
            rows: listRows,
            periodLabel,
            generatedAt: new Date().toLocaleString(),
            earned: (row) => earnedAmount(row.bonus_amount, row.days_worked, row.workdays)
        });
        downloadXls(bonusXlsFilename(periodLabel), periodLabel, table);
    };

    /** A finished bulk import: like Load Last Month, reload with the filter wide open. */
    const handleImported = async (result) => {
        setIsImportOpen(false);
        setActionError(null);
        resetTeamFilter.current = true;
        await loadMonth(year, month, { silent: true });

        const skippedNote = (result.skipped || [])
            .slice(0, 3)
            .map(skip => `${skip.name} (${skip.reason})`)
            .join('; ');
        setActionNotice(
            `Imported ${result.added} employee${result.added === 1 ? '' : 's'} into ${periodLabel}.`
            + (result.skipped?.length
                ? ` ${result.skipped.length} skipped: ${skippedNote}${result.skipped.length > 3 ? '…' : ''}`
                : '')
        );
    };

    /**
     * After a confirmed approval. The period is already locked server-side by the time this
     * runs, so the reload is what makes the screen agree with it.
     *
     * Approval and notification are reported SEPARATELY and on purpose: a mail server being
     * down does not un-approve a month, so the first line is always the success and the
     * second says what happened to the email. Three outcomes, and the user is told which.
     */
    const handleApproved = async (result) => {
        setIsApprovalOpen(false);
        setActionError(null);
        await loadMonth(year, month, { silent: true });

        const email = result.email || {};
        const approved = `✓ Bonuses approved successfully for ${periodLabel}.`;

        if (email.sent) {
            setActionNotice(
                `${approved} ✓ Finance notification sent to ${email.count} `
                + `recipient${email.count === 1 ? '' : 's'}.`
            );
        } else if (!email.attempted) {
            setActionNotice(
                `${approved} ⚠ No email recipients are configured for the Finance notification — `
                + 'add them in Configuration > HR > Bonus Approval Email.'
            );
        } else {
            setActionNotice(
                `${approved} ⚠ The Finance notification could not be sent`
                + `${email.error ? `: ${email.error}` : '.'} The approval stands.`
            );
        }
    };

    const handleToggleTeam = (team) => {
        setSelectedTeams(current => {
            const next = new Set(current);
            if (next.has(team)) next.delete(team); else next.add(team);
            return next;
        });
    };

    const handleViewModeChange = (mode) => {
        setViewMode(mode);
        saveViewMode(VIEW_MODE_KEY, mode);
        // The chips are the only way to see or undo this filter, and they live in the List.
        // Carrying it into the Grid would be a filter with no visible control.
        if (mode !== 'list') setCurrencyFilter(null);
    };

    /** Drops out of the team modal into the editable rows for that team alone. */
    const handleEditTeam = (team) => {
        setSelectedTeams(new Set([team]));
        handleViewModeChange('list');
        setOpenTeam(null);
    };

    /**
     * One entry per team, each carrying a per-currency subtotal — a team paying some people
     * in pesos and others in dollars has two figures, not one converted total. No exchange
     * rate is applied anywhere in this module, deliberately: nobody has given it one.
     */
    const teamSummaries = useMemo(() => {
        const byTeam = new Map();
        currencyFilteredRows.forEach(row => {
            const team = row.team_name || 'No team';
            if (!byTeam.has(team)) byTeam.set(team, []);
            byTeam.get(team).push(row);
        });
        return Array.from(byTeam.entries())
            .map(([team, teamRows]) => ({ team, rows: teamRows, totals: totalsOf(teamRows) }))
            .sort((a, b) => a.team.localeCompare(b.team));
    }, [currencyFilteredRows]);

    // Two totals, and the difference is the point.
    //
    // `overallTotals` feeds the two chips and is deliberately NOT narrowed by them: a chip
    // that zeroed itself the moment you pressed it would be both useless and impossible to
    // read your way out of. `gridTotals` is what the All Teams card shows, and that one DOES
    // follow the chip — the card describes the cards beneath it, and those are filtered.
    const overallTotals = useMemo(() => totalsOf(teamFilteredRows), [teamFilteredRows]);
    const gridTotals = useMemo(() => totalsOf(currencyFilteredRows), [currencyFilteredRows]);

    const openTeamSummary = openTeam
        ? teamSummaries.find(summary => summary.team === openTeam)
        : null;

    const renderCurrencyTotals = (totals) =>
        Array.from(totals.entries()).map(([code, amounts]) => (
            <React.Fragment key={code}>
                <div className="team-card-stat">
                    <span className="team-card-stat-label">Bonus Amount ({currencyOf(code).symbol})</span>
                    <span className={`team-card-stat-value ${currencyClass(code)}`}>
                        {formatBonusAmount(amounts.budget, code)}
                    </span>
                </div>
                <div className="team-card-stat">
                    <span className="team-card-stat-label">Total Earned ({currencyOf(code).symbol})</span>
                    <span className={`team-card-stat-value ${currencyClass(code)}`}>
                        {formatBonusAmount(amounts.earned, code)}
                    </span>
                </div>
            </React.Fragment>
        ));

    if (loading) return <LoadingScreen loading={loading} message={`Preparing ${periodLabel} bonuses...`} />;

    return (
        <div className="stat-report-container">
            <div className="report-header">
                <button className="back-btn" onClick={onBack}>← Back</button>
                <h1>Bonus Home Office / Transportation</h1>
            </div>

            <div className="report-content">
                {error && <div className="bonus-banner is-error">{error}</div>}
                {actionError && <div className="bonus-banner is-error">{actionError}</div>}
                {actionNotice && <div className="bonus-banner is-info">{actionNotice}</div>}

                {/* What the month's status is, in the one place a reader is already looking
                    for messages about it. "Re-opened" is shown as well as "Approved": both
                    are facts about a month somebody signed off, and only one of them says
                    the list can be edited. */}
                {approval?.status === 'approved' && (
                    <div className="bonus-approved-banner">
                        <span className="bonus-approved-mark">✓</span>
                        <div className="bonus-approved-text">
                            <strong>Bonuses Approved</strong>
                            <span>
                                Approved by {approval.approved_by || 'an administrator'}
                                {approval.approved_at ? ` · ${formatApprovalMoment(approval.approved_at)}` : ''}
                                {' · '}Locked. Reopen it from Configuration &gt; HR to make changes.
                            </span>
                        </div>
                    </div>
                )}

                {approval?.status === 'reopened' && (
                    <div className="bonus-approved-banner is-reopened">
                        <span className="bonus-approved-mark">↺</span>
                        <div className="bonus-approved-text">
                            <strong>Re-opened</strong>
                            <span>
                                Approved by {approval.approved_by || 'an administrator'}, reopened by
                                {' '}{approval.reopened_by || 'an administrator'}
                                {approval.reopened_at ? ` · ${formatApprovalMoment(approval.reopened_at)}` : ''}
                                {approval.reopen_reason ? ` · “${approval.reopen_reason}”` : ''}
                            </span>
                        </div>
                    </div>
                )}

                <div className="report-section">
                    <div className="section-header-row">
                        <div className="bonus-title-block">
                            <h3>{periodLabel}</h3>

                            {/* How many rows the List is actually showing, and out of how
                                many the month holds. "45 of 267" is the answer to "why am I
                                seeing so few" that a bare 45 is not — and when nothing is
                                filtered the two are equal, so it collapses to one number
                                rather than repeating itself. */}
                            {viewMode === 'list' && (
                                <span
                                    className="bonus-count-chip"
                                    title={isFiltered
                                        ? `${listRows.length} of ${rows.length} employees match the ${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}`
                                        : `${rows.length} employee${rows.length === 1 ? '' : 's'} on ${periodLabel}`}
                                >
                                    <span className="bonus-count-chip-label">
                                        {isFiltered ? 'Showing' : 'Employees'}
                                    </span>
                                    <span className="bonus-count-chip-value">
                                        <PersonIcon />
                                        {isFiltered
                                            ? `${listRows.length} of ${rows.length}`
                                            : rows.length}
                                    </span>
                                </span>
                            )}

                            {/* Both currencies, always — the point is to read the month's
                                payout at a glance, and a missing chip reads as a bug rather
                                than as a zero. Shown in BOTH views: the figures describe the
                                month, not the table, and pressing one now narrows the Grid's
                                team cards exactly as it narrows the List. */}
                            <div className="bonus-header-totals">
                                {BONUS_CURRENCIES.map(currency => {
                                    const amounts = overallTotals.get(currency.code)
                                        || { budget: 0, earned: 0 };
                                    const isFiltering = currencyFilter === currency.code;
                                    return (
                                        <button
                                            type="button"
                                            key={currency.code}
                                            className={`bonus-total-chip ${currencyClass(currency.code)} ${isFiltering ? 'is-active' : ''}`}
                                            aria-pressed={isFiltering}
                                            onClick={() => setCurrencyFilter(prev => (
                                                prev === currency.code ? null : currency.code
                                            ))}
                                            title={isFiltering
                                                ? `Showing only ${currency.label}. Press again to show every currency.`
                                                : `Of ${formatBonusAmount(amounts.budget, currency.code)} budgeted. Press to show only ${currency.label}.`}
                                        >
                                            <span className="bonus-total-chip-label">
                                                Total {currency.symbol}{isFiltering ? ' ✓' : ''}
                                            </span>
                                            <span className={`bonus-total-chip-value ${currencyClass(currency.code)}`}>
                                                {formatBonusAmount(amounts.earned, currency.code)}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="bonus-toolbar">
                            {/* List only, like Export and Reset filters beside it: all three
                                describe the rows on screen, and the Grid shows team cards
                                rather than rows for them to mean anything about. */}
                            {viewMode === 'list' && (
                                <div className="bonus-search">
                                    <span className="bonus-search-icon">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="11" cy="11" r="8" />
                                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                        </svg>
                                    </span>
                                    <input
                                        type="text"
                                        className="bonus-search-input"
                                        placeholder="Search ID, name, team, company…"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Escape') setSearch(''); }}
                                        title="Matches ID, Employee Name, Team and Company. Accents are ignored, and each word may land in a different column."
                                    />
                                    {search !== '' && (
                                        <button
                                            type="button"
                                            className="bonus-search-clear"
                                            onClick={() => setSearch('')}
                                            title="Clear the search"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Approve replaces the whole add cluster once the month is
                                signed off: nothing can be added to it, and the one action
                                that remains is reopening it from Configuration > HR. */}
                            {!isLocked && (
                            <div className="bonus-add-split">
                                <button
                                    className="bonus-add-btn bonus-add-btn-main"
                                    onClick={() => setIsAddOpen(true)}
                                >
                                    + Add Employee
                                </button>
                                <button
                                    className="bonus-add-btn bonus-add-btn-caret"
                                    onClick={() => setAddMenuOpen(open => !open)}
                                    title="More add options"
                                >
                                    ▾
                                </button>

                                {addMenuOpen && (
                                    <>
                                        <div className="dropdown-overlay" onClick={() => setAddMenuOpen(false)} />
                                        <div className="dropdown-menu bonus-add-menu">
                                            <button
                                                className="view-toggle-option"
                                                onClick={() => { setIsAddOpen(true); setAddMenuOpen(false); }}
                                            >
                                                <span className="view-toggle-label">Add Employee</span>
                                            </button>
                                            <button
                                                className="view-toggle-option"
                                                onClick={handleLoadLastMonth}
                                            >
                                                <span className="view-toggle-label">Load Last Month list</span>
                                            </button>
                                            <button
                                                className="view-toggle-option"
                                                onClick={() => { setIsImportOpen(true); setAddMenuOpen(false); }}
                                            >
                                                <span className="view-toggle-label">Import List</span>
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                            )}

                            {/* Only while the period is open, and only in List view -- the
                                Grid has no rows on screen for "approve what is here" to
                                mean anything against. */}
                            {!isLocked && viewMode === 'list' && (
                                <button
                                    className="bonus-approve-btn"
                                    onClick={() => setIsApprovalOpen(true)}
                                    disabled={rows.length === 0}
                                    title={rows.length === 0
                                        ? 'There is nobody on this month’s list to approve'
                                        : `Review and approve the whole ${periodLabel} list`}
                                >
                                    ✓ Approve Bonuses
                                </button>
                            )}

                            <select
                                className="bonus-select"
                                value={month}
                                onChange={(e) => setMonth(Number(e.target.value))}
                                title="Bonus month"
                            >
                                {MONTHS.map((name, index) => (
                                    <option key={name} value={index + 1}>{name}</option>
                                ))}
                            </select>

                            <select
                                className="bonus-select"
                                value={year}
                                onChange={(e) => setYear(Number(e.target.value))}
                                title="Bonus year"
                            >
                                {yearOptions.map(option => (
                                    <option key={option} value={option}>{option}</option>
                                ))}
                            </select>

                            {/* List view only: the export is the rows as filtered and sorted
                                on screen, and Grid has no rows on screen to mean by that. */}
                            {viewMode === 'list' && (
                                <button
                                    className="bonus-export-btn"
                                    onClick={handleExport}
                                    disabled={listRows.length === 0}
                                    title={activeFilterCount > 0
                                        ? `Exports the ${listRows.length} rows matching the ${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}`
                                        : `Exports the full ${periodLabel} list as a styled Excel file`}
                                >
                                    ⬇ Export
                                </button>
                            )}

                            {/* Appears only when something is actually hidden, and says how
                                many columns are doing the hiding — which is what answers
                                "why am I seeing so few rows". Sorting is not counted: it
                                hides nothing, and it resets with a third click on a header. */}
                            {viewMode === 'list' && activeFilterCount > 0 && (
                                <button
                                    className="bonus-reset-filters"
                                    onClick={handleResetFilters}
                                    title="Clear the search, every column filter, the currency chip and the team filter"
                                >
                                    ✕ Reset filters ({activeFilterCount})
                                </button>
                            )}

                            {/* List has the same filter in its Team header, and two controls
                                for one selection is one too many. Grid has no header row at
                                all, so there it is the only way to narrow by team — which is
                                why this is hidden rather than deleted. Both edit the same
                                `selectedTeams`, so switching views never loses the choice. */}
                            {viewMode !== 'list' && (
                                <TeamFilter
                                    teams={availableTeams}
                                    selectedTeams={selectedTeams}
                                    onToggle={handleToggleTeam}
                                    onSelectAll={() => setSelectedTeams(new Set(availableTeams))}
                                    onClearAll={() => setSelectedTeams(new Set())}
                                />
                            )}

                            <ViewToggle viewMode={viewMode} onChange={handleViewModeChange} />
                        </div>
                    </div>

                    {viewMode === 'grid' ? (
                        <div className="team-cards-wrapper">
                            <div className="team-cards-grid">
                                {currencyFilteredRows.length > 0 && (
                                    <div className="team-card global-team-card">
                                        <div className="team-card-header">
                                            <span className="team-link-btn">All Teams</span>
                                            <span
                                                className="team-card-metric-value bonus-card-count"
                                                title={`${currencyFilteredRows.length} employee${currencyFilteredRows.length === 1 ? '' : 's'}`}
                                            >
                                                <PersonIcon />
                                                {currencyFilteredRows.length}
                                            </span>
                                        </div>
                                        <div className="team-card-stats">
                                            {renderCurrencyTotals(gridTotals)}
                                            <div className="team-card-stat team-card-stat-dates">
                                                <span className="team-card-stat-label">Period</span>
                                                <span className="team-card-stat-value">{periodLabel}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {teamSummaries.map(summary => (
                                    <div
                                        key={summary.team}
                                        className="team-card clickable-row"
                                        onClick={() => setOpenTeam(summary.team)}
                                        title={`Open ${summary.team}`}
                                    >
                                        <div className="team-card-header">
                                            <span className="team-link-btn">{summary.team}</span>
                                            {/* The count lives here alone — a second
                                                "Employees" line below said the same number
                                                twice on a card with four lines of room. The
                                                icon is what says what the number counts. */}
                                            <span
                                                className="team-card-metric-value bonus-card-count"
                                                title={`${summary.rows.length} employee${summary.rows.length === 1 ? '' : 's'}`}
                                            >
                                                <PersonIcon />
                                                {summary.rows.length}
                                            </span>
                                        </div>
                                        <div className="team-card-stats">
                                            {renderCurrencyTotals(summary.totals)}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {currencyFilteredRows.length === 0 && (
                                <div className="report-empty-state">
                                    {rows.length === 0
                                        ? `No employees on the ${periodLabel} bonus list yet. Use “+ Add Employee” to start one.`
                                        : currencyFilter !== null && teamFilteredRows.length > 0
                                            ? `Nobody on ${periodLabel} is paid in ${currencyOf(currencyFilter).label}. Press the chip again to show every currency.`
                                            : 'No teams match the current filter.'}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="report-table-wrapper bonus-table-wrapper">
                            <table
                                className="report-table bonus-table"
                                ref={tableRef}
                                style={{ minWidth: totalColumnWidth }}
                            >
                                <thead>
                                    <tr>
                                        {BONUS_COLUMNS.map(column => {
                                            const sorted = sortConfig?.key === column.id;
                                            const filter = columnFilterFor(column);
                                            const options = optionsFor(column);
                                            const sortTitle = sorted
                                                ? `Sorted ${sortConfig.direction === 'asc' ? 'ascending' : 'descending'}. Click again to ${sortConfig.direction === (column.type === 'number' ? 'desc' : 'asc') ? 'reverse it' : 'go back to the default order'}.`
                                                : `Sort by ${column.label}`;
                                            return (
                                                <th
                                                    key={column.id}
                                                    className={`${column.className} sortable-header ${sorted ? 'is-active' : ''}`}
                                                    style={{ width: columnWidths[column.id] }}
                                                >
                                                    <span className="bonus-header-content">
                                                        {/* The label is the keyboard-reachable sort control. */}
                                                        <button
                                                            type="button"
                                                            className="bonus-header-sort"
                                                            onClick={() => handleSort(column)}
                                                            title={sortTitle}
                                                        >
                                                            <span className="bonus-header-label">{column.label}</span>
                                                        </button>

                                                        {/* Arrows stacked over the funnel. The arrows repeat what the
                                                            label button already does, so they are a second mouse target
                                                            rather than a second tab stop. */}
                                                        <span className="bonus-header-tools">
                                                            <button
                                                                type="button"
                                                                tabIndex={-1}
                                                                aria-hidden="true"
                                                                className="bonus-header-arrows"
                                                                onClick={() => handleSort(column)}
                                                                title={sortTitle}
                                                            >
                                                                <span className="sort-indicator">
                                                                    {sorted ? (
                                                                        <span
                                                                            className={`sort-indicator-single sort-arrow ${sortConfig.direction === 'asc' ? 'sort-arrow-up' : 'sort-arrow-down'}`}
                                                                        />
                                                                    ) : (
                                                                        <span className="sort-indicator-both">
                                                                            <span className="sort-arrow sort-arrow-up" />
                                                                            <span className="sort-arrow sort-arrow-down" />
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            </button>

                                                            <BonusColumnFilter
                                                                column={column}
                                                                value={filter}
                                                                options={options}
                                                                isActive={isFilterActive(column, filter, options)}
                                                                onChange={(next) => setColumnFilter(column, next)}
                                                                onClear={() => clearColumnFilter(column)}
                                                            />
                                                        </span>

                                                        {/* Drag to resize, double-click to fit the widest cell. */}
                                                        <span
                                                            className="bonus-col-resizer"
                                                            role="presentation"
                                                            onMouseDown={(e) => startColumnResize(column, e)}
                                                            onDoubleClick={(e) => { e.stopPropagation(); autoFitColumn(column); }}
                                                            title="Drag to resize · double-click to fit the widest value"
                                                        />
                                                    </span>
                                                </th>
                                            );
                                        })}
                                        <th
                                            className="bonus-col-actions"
                                            aria-label="Actions"
                                            style={{ width: ACTIONS_COLUMN_WIDTH }}
                                        />
                                        {/* No width, so fixed layout gives it whatever is
                                            left over — and nothing at all once the columns
                                            fill the viewport. */}
                                        <th className="bonus-col-filler" aria-hidden="true" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {listRows.map(row => (
                                        <tr key={row.id}>
                                            <td>
                                                <span
                                                    className={`bonus-employee-id ${row.employee_id === null ? 'is-manual' : ''}`}
                                                    title={row.employee_id === null
                                                        ? 'Added by hand — no DeskTime record behind this row'
                                                        : 'DeskTime employee ID'}
                                                >
                                                    {row.employee_id ?? '—'}
                                                </span>
                                            </td>
                                            <td>
                                                <div className="bonus-name-cell bonus-reset-host">
                                                    <BonusComboCell
                                                        value={row.employee_name}
                                                        options={rosterOptions.filter(option =>
                                                            option.key === row.employee_id
                                                            || !enrolledEmployeeIds.has(option.key)
                                                        )}
                                                        className={nameIsOverridden(row) ? 'is-overridden' : ''}
                                                        readOnly={isLocked}
                                                        onSelect={(option) => handleEmployeeSelect(row, option)}
                                                        onCommitText={(name) => handleEmployeeText(row, name)}
                                                        title={row.employee_id
                                                            ? 'Linked to DeskTime — pick another name to swap the employee'
                                                            : 'Added manually — pick a name to link it to DeskTime'}
                                                        emptyLabel="No DeskTime employee matches. Leave the cell to keep the typed name."
                                                    />

                                                    {/* Routed through handleEmployeeText so the restore gets the
                                                        same instant collision check a typed rename gets — the
                                                        DeskTime name could itself clash with another row. */}
                                                    {!isLocked && nameIsOverridden(row) && (
                                                        <button
                                                            type="button"
                                                            tabIndex={-1}
                                                            className="bonus-cell-reset"
                                                            onMouseDown={(e) => e.preventDefault()}
                                                            onClick={() => handleEmployeeText(row, row.assigned_employee_name)}
                                                            title={`Renamed by hand. Back to "${row.assigned_employee_name}", the name DeskTime has on record.`}
                                                            aria-label="Reset to the DeskTime name"
                                                        >
                                                            ↺
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                <div className="bonus-team-cell bonus-reset-host">
                                                    <BonusComboCell
                                                        value={row.team_name}
                                                        options={teamOptions}
                                                        placeholder="No team"
                                                        className={teamIsOverridden(row) ? 'is-overridden' : ''}
                                                        onSelect={(option) => handleTeamSelect(row, option)}
                                                        onCommitText={(team) => handleTeamText(row, team)}
                                                        emptyLabel="No team matches. Leave the cell to keep the typed name."
                                                    />

                                                    {!isLocked && teamIsOverridden(row) && (
                                                        <span className="bonus-cell-actions">
                                                            <button
                                                                type="button"
                                                                tabIndex={-1}
                                                                className="bonus-cell-reset"
                                                                onMouseDown={(e) => e.preventDefault()}
                                                                onClick={() => handleTeamReset(row)}
                                                                title={`Changed by hand. Back to ${row.assigned_team_name || 'the assigned team'}.`}
                                                                aria-label="Reset to the assigned team"
                                                            >
                                                                ↺
                                                            </button>
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                <BonusComboCell
                                                    strict
                                                    value={row.company_name}
                                                    options={companyOptions}
                                                    placeholder={NO_COMPANY_LABEL}
                                                    onSelect={(option) => handleCompanyChange(row, option)}
                                                    onCommitText={() => {}}
                                                    title="Pick a company from Configuration > HR > Company"
                                                    emptyLabel="No company matches. Add it in Configuration > HR > Company."
                                                />
                                            </td>
                                            <td>
                                                <div className="bonus-days-cell bonus-reset-host">
                                                    <EditableDaysCell
                                                        readOnly={isLocked}
                                                        value={row.days_worked}
                                                        autoValue={row.days_worked_auto}
                                                        isOverridden={row.days_worked_override !== null}
                                                        max={row.workdays}
                                                        onCommit={(v) => handleDaysChange(row, v)}
                                                    />
                                                    <span className="bonus-days-separator">/</span>
                                                    <span
                                                        className="bonus-workdays"
                                                        title={`Working days in ${periodLabel} for this team`}
                                                    >
                                                        {row.workdays}
                                                    </span>

                                                    {/* Both kept out of the tab order and shown by CSS on hover or
                                                        focus-within, so they stay out of the way until the cell is
                                                        being worked on. preventDefault on mousedown is what keeps
                                                        the input focused long enough for the click to land: without
                                                        it the blur hides the button mid-press. */}
                                                    <span className="bonus-cell-actions">
                                                        {/* Only on a row somebody has typed over — there is nothing
                                                            to undo otherwise. It grows the lane leftwards, so the
                                                            breakdown button below stays put as it comes and goes. */}
                                                        {!isLocked && row.days_worked_override !== null && (
                                                            <button
                                                                type="button"
                                                                tabIndex={-1}
                                                                className="bonus-cell-reset"
                                                                onMouseDown={(e) => e.preventDefault()}
                                                                onClick={() => handleDaysChange(row, null)}
                                                                title={`Manually set. Back to the ${row.days_worked_auto} days the platform calculated.`}
                                                                aria-label="Reset to the calculated days"
                                                            >
                                                                ↺
                                                            </button>
                                                        )}

                                                        {/* Nothing to break down for a name typed by hand: no
                                                            DeskTime record means no days to list. */}
                                                        {row.employee_id !== null && (
                                                            <button
                                                                type="button"
                                                                tabIndex={-1}
                                                                className="bonus-cell-detail"
                                                                onMouseDown={(e) => e.preventDefault()}
                                                                onClick={() => setOpenDaysRow(row)}
                                                                title={`See which days of ${periodLabel} counted, and which were missed`}
                                                                aria-label="Show the day-by-day breakdown"
                                                            >
                                                                ☰
                                                            </button>
                                                        )}
                                                    </span>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="bonus-amount-cell">
                                                    <div className="bonus-cell-amount">
                                                        <EditableAmountCell
                                                            readOnly={isLocked}
                                                            value={row.bonus_amount}
                                                            currency={row.currency}
                                                            onCommit={(amount) => handleAmountChange(row, amount)}
                                                        />
                                                    </div>
                                                    <BonusCurrencySelect
                                                        compact
                                                        disabled={isLocked}
                                                        value={row.currency}
                                                        onChange={(code) => handleCurrencyChange(row, code)}
                                                    />
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`bonus-earned ${currencyClass(row.currency)}`}>
                                                    {formatBonusAmount(
                                                        earnedAmount(row.bonus_amount, row.days_worked, row.workdays),
                                                        row.currency
                                                    )}
                                                </span>
                                            </td>
                                            <td>
                                                <EditableTextCell
                                                    readOnly={isLocked}
                                                    value={row.comments}
                                                    className="bonus-cell-comment"
                                                    placeholder="Add a note…"
                                                    onCommit={(text) => handleCommentsChange(row, text)}
                                                />
                                            </td>
                                            <td>
                                                {/* Gone rather than disabled while locked: there is
                                                    no state in which removing a row from an approved
                                                    month is the next thing to do. */}
                                                {!isLocked && (
                                                    <button
                                                        className="bonus-row-remove"
                                                        onClick={() => handleDelete(row)}
                                                        title={`Remove ${row.employee_name}`}
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </td>
                                            <td className="bonus-col-filler" />
                                        </tr>
                                    ))}

                                    {listRows.length === 0 && (
                                        <tr>
                                            <td colSpan={10} className="report-empty-state">
                                                {rows.length === 0
                                                    ? `No employees on the ${periodLabel} bonus list yet. Use “+ Add Employee” to start one.`
                                                    : activeFilterCount === 0
                                                        ? 'No employees match the current team filter.'
                                                        : `No employees match the ${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}. Use “Reset filters” to show everyone.`}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {openTeamSummary && (
                <BonusTeamModal
                    team={openTeamSummary.team}
                    rows={openTeamSummary.rows.map(row => ({
                        ...row,
                        total_earned: earnedAmount(row.bonus_amount, row.days_worked, row.workdays)
                    }))}
                    totals={openTeamSummary.totals}
                    periodLabel={periodLabel}
                    onClose={() => setOpenTeam(null)}
                    onEdit={() => handleEditTeam(openTeamSummary.team)}
                />
            )}

            {openDaysRow && (
                <BonusDaysModal
                    employeeId={openDaysRow.employee_id}
                    employeeName={openDaysRow.employee_name}
                    year={year}
                    month={month}
                    periodLabel={periodLabel}
                    onClose={() => setOpenDaysRow(null)}
                />
            )}

            {isApprovalOpen && (
                <BonusApprovalModal
                    year={year}
                    month={month}
                    periodLabel={periodLabel}
                    onClose={() => setIsApprovalOpen(false)}
                    onApproved={handleApproved}
                />
            )}

            {isImportOpen && (
                <ImportBonusListModal
                    year={year}
                    month={month}
                    periodLabel={periodLabel}
                    roster={roster}
                    companies={companies}
                    onClose={() => setIsImportOpen(false)}
                    onImported={handleImported}
                />
            )}

            {isAddOpen && <AddBonusEmployeeModal
                roster={roster}
                companies={companies}
                enrolledEmployeeIds={enrolledEmployeeIds}
                enrolledNames={enrolledNames}
                periodLabel={periodLabel}
                onClose={() => setIsAddOpen(false)}
                onConfirm={handleAddEmployee}
            />}
        </div>
    );
};

export default BonusHomeOffice;
