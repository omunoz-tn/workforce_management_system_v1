import React, { useState, useEffect, useMemo } from 'react';
import './ScheduleBoard.css';
// The card markup used to live here as formatShift(); it moved to ShiftCard so Shift
// Management renders the identical card rather than a copy that can drift.
import ShiftCard, { shiftHours, formatTime, lunchHoursFor } from './ShiftCard';
import { todayStr, parseDate, formatDate, mondayOf, firstOfMonth, lastOfMonth, isoWeekdayOf, ISO_WEEKDAYS } from '../utils/dates';
import WeekPicker from './WeekPicker';
import MonthPicker from './MonthPicker';
import { downloadCsv } from '../utils/csv';
import { normalizeForSearch } from '../utils/search';
// Same source of truth as the Holidays screen. The Month view draws the very chips that
// screen draws — including the country and type colors an admin picked in Configuration >
// Scheduling > Holiday — rather than a look-alike with a palette of its own.
import { HOLIDAY_TYPES, FlagIcon, getCountry, getHolidayType } from './Holidays';


// Lucide's "calendar-pen" geometry, inlined because lucide-react 1.28.0 does not export it
// yet (CalendarCog is the closest it ships, and Holidays already uses that one for the
// Custom holiday type — reusing it here would make two different things look alike).
// Drawn with Lucide's own conventions so it sits consistently next to the icons that do
// come from the package: 24x24 box, 2px stroke, round caps and joins.
const IconEditSchedule = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
        <path d="M3 10h18" />
        <path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
    </svg>
);

// The three kinds of day the board can show, in the order the tier chain in
// get_schedule_board.php resolves them. The labels are the ones ShiftCard already prints on
// the card itself, so filtering by "Forecast" selects exactly the cells wearing a Forecast
// badge — the dropdown and the badges cannot describe the same cell differently.
const SCHEDULE_TYPES = [
    { id: 'all', label: 'All Types' },
    { id: 'normal', label: 'Normal' },
    { id: 'forecast', label: 'Forecast' },
    { id: 'manual', label: 'Manual Forecast' }
];

// MON…SUN, read off the ISO ordering the rest of the app lays a week out with, so the Month
// grid cannot start its week on a different day than the Week view's columns do.
const WEEKDAY_HEADERS = ISO_WEEKDAYS.map(d => d.short.toUpperCase());

/**
 * Which of the three a day is, or null when it is none of them — a cell holding nothing but
 * a holiday marker, which the endpoint adds for a day with neither synced data nor a
 * projection. Those are deliberately left out of every named type instead of being counted
 * as Normal: nothing about them came from DeskTime.
 *
 * Order matters. A manual override is also flagged `predicted`, so it has to be tested
 * first, exactly as ShiftCard does when it picks which badge to draw.
 */
const scheduleType = (schedule) => {
    if (!schedule) return null;
    if (schedule.manualOverride) return 'manual';
    if (schedule.predicted) return 'forecast';
    if (schedule.synced) return 'normal';
    return null;
};

/**
 * A day's holidays as one CSV note, in the same "most restrictive wins" order the card's
 * tag uses on screen — so a day labelled Non-Working on the board is labelled Non-Working
 * in the file. Shared by the Week and Month exports.
 */
const holidayNote = (schedule) => {
    const holidays = schedule?.holidays || [];
    if (holidays.length === 0) return '';
    const rank = { non_working: 3, campaign_defined: 2, working: 1 };
    const worst = holidays.reduce((a, b) => (rank[b.type] || 0) > (rank[a.type] || 0) ? b : a);
    const type = HOLIDAY_TYPES.find(t => t.id === worst.type);
    const window = worst.from ? ` ${formatTime(worst.from)}-${formatTime(worst.to)} excluded` : '';
    return ` [${type ? type.badge : worst.type} Holiday${window}]`;
};

/**
 * One day as either export writes it. A day filtered out on screen is blank in the file
 * too, rather than reappearing as OFF — which is what it would look like if this read
 * emp.schedules directly.
 */
const exportCell = (schedule, filteredOut) => {
    if (filteredOut) return '';
    const note = holidayNote(schedule);
    if (!schedule || schedule.start === '00:00:00') return `OFF${note}`;
    return `${formatTime(schedule.start)} - ${formatTime(schedule.end)}${note}`;
};

const ScheduleBoard = ({ onEditSchedule = null }) => {
    // Anchored at noon on today's Santo Domingo date, so every week offset below stays on
    // the intended calendar day regardless of the machine's timezone. Shared by both views —
    // Week reads the week it falls in, Month the month — so switching views keeps the user
    // roughly where they were.
    const [currentDate, setCurrentDate] = useState(() => parseDate());
    const [viewMode, setViewMode] = useState('week');
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // ── Month view ──────────────────────────────────────────────────────────────────────
    // The roster is the one the board itself lists (get_schedule_board.php?roster=1 answers
    // with the names only), so the Month view searches exactly the people the Week view
    // shows. Loaded lazily: a user who never opens Month view never pays for it.
    const [roster, setRoster] = useState([]);
    const [rosterLoading, setRosterLoading] = useState(false);
    const [pinnedEmployeeId, setPinnedEmployeeId] = useState(null);
    const [monthEmployee, setMonthEmployee] = useState(null); // one board row, a whole month
    const [monthLoading, setMonthLoading] = useState(false);
    const [monthHolidays, setMonthHolidays] = useState({});   // date => [{name, type, country}]
    const [typeColors, setTypeColors] = useState({});
    const [countryColors, setCountryColors] = useState({});

    const isMonth = viewMode === 'month';

    const monday = mondayOf(formatDate(currentDate));
    const weekDates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return formatDate(d);
    });

    // The first of the month on screen, noon-anchored for the reason at the top of
    // utils/dates. Everything the Month view does — its API range, its grid, its totals and
    // the picker in its nav — is derived from this one value.
    const monthAnchor = firstOfMonth(formatDate(currentDate));
    const monthStart = formatDate(monthAnchor);
    const monthEnd = formatDate(lastOfMonth(monthStart));

    // The range on screen, whichever view is drawing it — read by the header label and the
    // export filename, so neither has to know which view it is in.
    const fromDate = isMonth ? monthStart : weekDates[0];
    const toDate = isMonth ? monthEnd : weekDates[6];

    // The Week view's full-board fetch. Guarded on the view because the Month view moves
    // `currentDate` by whole months, and every one of those steps would otherwise pull the
    // entire roster's week — the heaviest call this screen makes — for a week nobody is
    // looking at.
    useEffect(() => {
        if (isMonth) return undefined;
        let cancelled = false;

        const fetchSchedule = async () => {
            setLoading(true);
            try {
                const response = await fetch(`./api/get_schedule_board.php?from=${weekDates[0]}&to=${weekDates[6]}`);
                const result = await response.json();
                if (cancelled) return;
                if (result.success) {
                    setData(result.data);
                    setError(null);
                } else {
                    setError(result.error);
                }
            } catch (err) {
                if (!cancelled) setError("Failed to fetch schedule data.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchSchedule();
        return () => { cancelled = true; };
    // weekDates is a fresh array each render, so its two bounds stand in for it here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMonth, weekDates[0], weekDates[6]]);

    // The roster the Month view searches, for the month on screen. It is fetched per month
    // rather than once, because it is not the same list every month: someone who left in
    // August belongs to August's roster and not to September's, and asking without a range
    // would answer with today's roster for every month.
    useEffect(() => {
        if (!isMonth) return;

        let cancelled = false;
        setRosterLoading(true);
        fetch(`./api/get_schedule_board.php?roster=1&from=${monthStart}&to=${monthEnd}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (json.success) setRoster(json.data || []);
                else setError(json.error || 'Failed to load employees.');
            })
            .catch(() => { if (!cancelled) setError('Failed to load employees.'); })
            .finally(() => { if (!cancelled) setRosterLoading(false); });

        return () => { cancelled = true; };
    }, [isMonth, monthStart, monthEnd]);

    // The chip colors the Holidays screen was configured with. Unlike the roster these do
    // not change with the month, so they stay on a fetch-once effect.
    useEffect(() => {
        if (!isMonth || Object.keys(typeColors).length > 0) return;

        fetch('./api/manage_holiday_type_colors.php')
            .then(res => res.json())
            .then(json => {
                if (!json.success) return;
                const map = {};
                (json.colors || []).forEach(c => { map[c.holiday_type] = c.color; });
                setTypeColors(map);
            })
            .catch(() => {});

        fetch('./api/manage_holiday_country_colors.php')
            .then(res => res.json())
            .then(json => {
                if (!json.success) return;
                const map = {};
                (json.colors || []).forEach(c => { map[c.country_code] = { color: c.color, text_color: c.text_color }; });
                setCountryColors(map);
            })
            .catch(() => {});
    // typeColors is read as a fetch-once guard, not tracked: listing it would re-run this
    // the moment the colors land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMonth]);

    // The month's holidays, org-wide. This is what the calendar shows when no single
    // employee is picked — there is no team then to resolve a type against — and the
    // stand-in while a picked employee's own month is still in flight.
    useEffect(() => {
        if (!isMonth) return undefined;
        let cancelled = false;

        fetch(`./api/get_holidays.php?from=${monthStart}&to=${monthEnd}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled || !json.success) return;
                const byDate = {};
                (json.holidays || []).forEach(h => {
                    // Normalised to the shape get_schedule_board.php attaches to a day, so
                    // one chip renderer serves both sources.
                    (byDate[h.holiday_date] = byDate[h.holiday_date] || []).push({
                        name: h.name,
                        type: h.holiday_type,
                        country: h.country_code
                    });
                });
                setMonthHolidays(byDate);
            })
            .catch(() => { if (!cancelled) setMonthHolidays({}); });

        return () => { cancelled = true; };
    }, [isMonth, monthStart, monthEnd]);

    // The Type filter is per DAY, not per employee. A row-level filter would be useless on
    // the current week, where nearly everyone has synced days behind today and projected
    // days ahead of it and would therefore match both Normal and Forecast. Instead the days
    // that do not match are blanked, which is what makes "Manual Forecast" answer the
    // question it is really being asked: which days are pinned by hand.
    const dayMatchesType = (schedule) => typeFilter === 'all' || scheduleType(schedule) === typeFilter;

    // The single accessor every consumer goes through — the table, the Weekly Hours column
    // and the CSV export — so what is drawn, what is totalled and what is exported are the
    // same set of days by construction.
    const visibleSchedule = (emp, date) => {
        const schedule = emp.schedules[date];
        return dayMatchesType(schedule) ? schedule : null;
    };

    // One predicate for both views, so the same search term selects the same people whether
    // it is filtering the week's table or narrowing the month down to one person.
    const matchesSearch = (name, team) => {
        const term = normalizeForSearch(searchTerm);
        return normalizeForSearch(name).includes(term) || normalizeForSearch(team).includes(term);
    };

    const filteredData = useMemo(() => {
        const matches = data.filter(emp => {
            if (!matchesSearch(emp.name, emp.team)) return false;
            // An employee with no day of the selected type this week is dropped entirely,
            // rather than left as a row of seven blanks.
            if (typeFilter === 'all') return true;
            return weekDates.some(date => scheduleType(emp.schedules[date]) === typeFilter);
        });
        if (!searchTerm.trim()) return matches;
        return [...matches].sort((a, b) => a.name.localeCompare(b.name));
    // weekDates is derived from currentDate and is a fresh array each render, so the week
    // string bounds stand in for it here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, searchTerm, typeFilter, weekDates[0], weekDates[6]]);

    // ── Who the Month view is drawing ───────────────────────────────────────────────────
    // A month holds 28-31 cards per employee; laying more than one person's over the same
    // grid would bury the calendar. So the Month view shows schedules only once the search
    // has come down to a single employee, and shows the month's holidays alone until then.
    const monthMatches = useMemo(
        () => roster.filter(emp => matchesSearch(emp.name, emp.team)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
        [roster, searchTerm]
    );

    // A search narrowed to exactly one person selects them on its own; the picker in the
    // notice bar covers every other case. The pin is resolved against `monthMatches` rather
    // than the whole roster, which is what drops it again when the search moves away from
    // that person.
    const selectedEmployee = useMemo(() => {
        const pinned = monthMatches.find(emp => emp.id === pinnedEmployeeId);
        if (pinned) return pinned;
        return monthMatches.length === 1 ? monthMatches[0] : null;
    }, [monthMatches, pinnedEmployeeId]);

    // Each view raises its own errors; carrying one across would leave the other showing a
    // failure it has no way to clear.
    const switchView = (mode) => {
        setViewMode(mode);
        setError(null);
    };

    const clearSelection = () => {
        // The search has to go too: leaving a term that matches one person behind would
        // just re-select them on the next render.
        setPinnedEmployeeId(null);
        setSearchTerm('');
    };

    // One employee, one month. `employee_id` is what keeps this off the whole-roster path:
    // the endpoint narrows every one of its queries to that person instead of projecting a
    // month for all 400+.
    useEffect(() => {
        if (!isMonth || !selectedEmployee) {
            setMonthEmployee(null);
            return undefined;
        }
        let cancelled = false;
        setMonthLoading(true);

        fetch(`./api/get_schedule_board.php?from=${monthStart}&to=${monthEnd}&employee_id=${selectedEmployee.id}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (json.success) {
                    setMonthEmployee((json.data || [])[0] || null);
                    setError(null);
                } else {
                    setError(json.error || 'Failed to fetch schedule data.');
                }
            })
            .catch(() => { if (!cancelled) setError('Failed to fetch schedule data.'); })
            .finally(() => { if (!cancelled) setMonthLoading(false); });

        return () => { cancelled = true; };
    }, [isMonth, selectedEmployee, monthStart, monthEnd]);

    // Weekly Hours delegates to shiftHours so the column, each card's own total and the
    // Run Rate all apply the same two holiday rules. It used to inline the subtraction and
    // ignore holidays entirely, which made a Non-Working day still add its full shift here
    // while the Run Rate dropped it.
    // Resolved per date, not per employee: Employee Lunch Time can give one person a
    // different lunch on each weekday, so Monday's card and Wednesday's can deduct
    // different amounts from the same row.
    const lunchHoursOn = (emp, date) =>
        lunchHoursFor(emp.lunch_by_weekday, emp.lunch_time, isoWeekdayOf(date));

    const calcWeeklyHours = (emp) =>
        weekDates.reduce(
            (total, date) => total + shiftHours(visibleSchedule(emp, date), lunchHoursOn(emp, date)),
            0
        );

    // ── Month grid ──────────────────────────────────────────────────────────────────────
    // Monday-first, padded out to whole weeks. Cells are built from a noon-anchored Date and
    // formatted with formatDate(), never toISOString(): the day a cell claims to be has to
    // be the day it asks the API for, in whatever timezone the browser is set to.
    const monthGrid = useMemo(() => {
        const anchor = parseDate(monthStart);
        const year = anchor.getFullYear();
        const month = anchor.getMonth();
        const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = Monday
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const cells = [];
        for (let i = 0; i < leadingBlanks; i++) cells.push(null);
        for (let day = 1; day <= daysInMonth; day++) cells.push(formatDate(new Date(year, month, day, 12)));
        while (cells.length % 7 !== 0) cells.push(null);

        return { cells, weekCount: cells.length / 7, dates: cells.filter(Boolean) };
    }, [monthStart]);

    // The employee's own month, once it has arrived. Until then the calendar still draws the
    // holidays, so paging through months never blanks the grid.
    const monthSchedules = (selectedEmployee && monthEmployee) ? monthEmployee.schedules : null;

    // Team-resolved holidays when an employee is on screen — the same date can be
    // Non-Working for one team and Working for another — and the org-wide list otherwise.
    const holidaysOn = (dateStr) => (monthSchedules
        ? (monthSchedules[dateStr]?.holidays || [])
        : (monthHolidays[dateStr] || []));

    // Same accessor and same shiftHours as the Weekly Hours column, so the month total is
    // the sum of exactly the days the calendar drew.
    const monthlyHours = useMemo(() => {
        if (!monthSchedules) return 0;
        return monthGrid.dates.reduce(
            (total, date) => total + shiftHours(visibleSchedule(monthEmployee, date), lunchHoursOn(monthEmployee, date)),
            0
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [monthSchedules, monthEmployee, monthGrid, typeFilter]);

    const monthLabel = parseDate(monthStart)
        .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    // Exports exactly the rows on screen: it reads filteredData, the same array the table
    // renders, so the active search carries over without a second filtering path.
    // Laid out like the board — one row per employee, one column per day — so the file
    // reads the way the screen does.
    const handleExportWeek = () => {
        const dayLabel = (date) => {
            const d = parseDate(date);
            return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${date}`;
        };

        const rows = [
            ['Employee', 'Team', 'Weekly Hours', ...weekDates.map(dayLabel)],
            ...filteredData.map(emp => [
                emp.name,
                emp.team || 'Unassigned',
                calcWeeklyHours(emp).toFixed(2),
                ...weekDates.map(date => exportCell(emp.schedules[date], !dayMatchesType(emp.schedules[date])))
            ])
        ];

        downloadCsv(`Schedule_Board_${fromDate}_to_${toDate}.csv`, rows);
    };

    // The Month export is one row per DAY rather than per employee: it only ever runs on the
    // single employee the calendar is drawing, so a row per day is the shape that matches
    // what is on screen.
    const handleExportMonth = () => {
        const rows = [
            ['Employee', 'Team', 'Date', 'Day', 'Shift', 'Hours'],
            ...monthGrid.dates.map(date => {
                const schedule = monthEmployee.schedules[date];
                const filteredOut = !dayMatchesType(schedule);
                return [
                    monthEmployee.name,
                    monthEmployee.team || 'Unassigned',
                    date,
                    parseDate(date).toLocaleDateString(undefined, { weekday: 'long' }),
                    exportCell(schedule, filteredOut),
                    filteredOut ? '' : shiftHours(schedule, lunchHoursOn(monthEmployee, date)).toFixed(2)
                ];
            })
        ];

        const safeName = monthEmployee.name.replace(/[^\w-]+/g, '_');
        downloadCsv(`Schedule_Month_${safeName}_${monthStart.slice(0, 7)}.csv`, rows);
    };

    const canExport = isMonth ? Boolean(monthEmployee) : filteredData.length > 0;
    const exportTitle = isMonth
        ? (monthEmployee
            ? `Export ${monthEmployee.name}'s ${monthLabel}`
            : 'Narrow the search to a single employee to export their month')
        : (filteredData.length === 0
            ? 'Nothing to export'
            : `Export the ${filteredData.length} rows currently listed${typeFilter === 'all' ? '' : ` (${SCHEDULE_TYPES.find(t => t.id === typeFilter).label} days only)`}`);

    const isToday = (dateStr) => dateStr === todayStr();

    // The Holidays screen's chip, drawn from the same country/type colors: background is the
    // country, the small square on the right is the holiday type. The type is named in the
    // tooltip rather than on the chip, which has to survive a 150px calendar cell.
    const renderHolidayChip = (holiday, idx) => {
        const country = getCountry(holiday.country, countryColors);
        const type = getHolidayType(holiday.type, typeColors);
        const window = holiday.from
            ? ` · ${formatTime(holiday.from)}–${formatTime(holiday.to)} not counted`
            : '';
        return (
            <span
                key={`${holiday.country}-${idx}`}
                className="sb-month-chip"
                style={{ '--chip-bg': country.color, '--chip-text': country.textColor }}
                title={`${holiday.name} — ${type.badge} Holiday (${country.name})${window}`}
            >
                <span className="sb-month-chip-flag"><FlagIcon country={country} /></span>
                <span className="sb-month-chip-name">{holiday.name}</span>
                <span className="sb-month-chip-dot" style={{ '--dot-color': type.color }} />
            </span>
        );
    };

    const renderMonthCalendar = () => (
        <div className="sb-month-wrapper">
            <div
                className={`sb-month-grid ${monthLoading ? 'is-loading' : ''}`}
                style={{ '--week-count': monthGrid.weekCount }}
            >
                {WEEKDAY_HEADERS.map(w => <div key={w} className="sb-month-weekday">{w}</div>)}
                {monthGrid.cells.map((dateStr, idx) => {
                    if (!dateStr) return <div key={`pad-${idx}`} className="sb-month-cell is-outside" />;

                    const schedule = monthSchedules ? monthSchedules[dateStr] : null;
                    const filteredOut = Boolean(monthSchedules) && !dayMatchesType(schedule);

                    return (
                        <div key={dateStr} className={`sb-month-cell ${isToday(dateStr) ? 'is-today' : ''}`}>
                            <span className="sb-month-day-number">{Number(dateStr.slice(8, 10))}</span>
                            {monthSchedules ? (
                                <div className="sb-month-shift">
                                    {filteredOut ? (
                                        <span
                                            className="shift-filtered-out"
                                            title={`Hidden by the ${SCHEDULE_TYPES.find(t => t.id === typeFilter).label} filter`}
                                        >
                                            —
                                        </span>
                                    ) : (
                                        // The card names the day's holiday itself, on the tag it
                                        // already draws in the Week view — so a day reads the same
                                        // in both grids, and the chips below are only for the
                                        // holidays-only mode, where there is no card to carry it.
                                        <ShiftCard
                                            schedule={schedule}
                                            lunchHours={lunchHoursOn(monthEmployee, dateStr)}
                                        />
                                    )}
                                </div>
                            ) : (
                                <div className="sb-month-chips">
                                    {holidaysOn(dateStr).map(renderHolidayChip)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <div className="schedule-board-container">
            <header className="board-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1>Schedule Board</h1>
                        <span className="badge">
                            {isMonth
                                ? (selectedEmployee ? '1 Employee' : `${monthMatches.length} Staff`)
                                : `${filteredData.length} Staff`}
                        </span>
                    </div>
                    <div className="week-range-label">
                        📅 {new Date(fromDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
                        —
                        {new Date(toDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                </div>

                <div className="header-controls">
                    <select
                        className="board-type-select"
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        aria-label="Filter days by schedule type"
                        title="Show only days of a given type"
                    >
                        {SCHEDULE_TYPES.map(type => (
                            <option key={type.id} value={type.id}>{type.label}</option>
                        ))}
                    </select>

                    <div className="search-filter-wrapper">
                        <div className="search-box">
                            <span className="search-icon">🔍</span>
                            <input
                                type="text"
                                placeholder={isMonth ? 'Search a single employee...' : 'Search name or team...'}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="navigation-controls board-view-toggle">
                        <button
                            type="button"
                            className={`nav-btn ${isMonth ? '' : 'is-active'}`}
                            onClick={() => switchView('week')}
                            title="One week, every employee"
                        >
                            Week
                        </button>
                        <button
                            type="button"
                            className={`nav-btn ${isMonth ? 'is-active' : ''}`}
                            onClick={() => switchView('month')}
                            title="A whole month, one employee at a time"
                        >
                            Month
                        </button>
                    </div>

                    {!isMonth && <WeekPicker monday={monday} onChange={setCurrentDate} />}

                    <button
                        type="button"
                        className="board-export-btn"
                        onClick={isMonth ? handleExportMonth : handleExportWeek}
                        disabled={!canExport || (!isMonth && loading)}
                        title={exportTitle}
                    >
                        Export
                    </button>
                </div>
            </header>

            {/* Month navigation, plus which of the two things the calendar below is showing
                and — when it is holidays only — the one control that changes that. The
                picker lives here rather than in the header because five controls in that row
                wrapped onto a second line, and the height that cost came out of the
                calendar. */}
            {isMonth && (
                <div className="sb-month-notice">
                    <MonthPicker monthStart={monthAnchor} onChange={setCurrentDate} align="left" />

                    {selectedEmployee ? (
                        <>
                            <span className="sb-month-emp">
                                <span className="emp-name-text">{selectedEmployee.name}</span>
                                <span className="emp-team-text">{selectedEmployee.team || 'Unassigned'}</span>
                            </span>
                            {/* A total is only worth printing once the month it totals has
                                arrived — 0.00 while the fetch is in flight reads as a real
                                answer, and it is the wrong one. */}
                            {monthLoading ? (
                                <span className="sb-month-status">Loading schedule…</span>
                            ) : monthSchedules ? (
                                <span className="sb-month-hours">
                                    Monthly Hours <strong>{monthlyHours.toFixed(2)}</strong>
                                </span>
                            ) : (
                                <span className="sb-month-status">No schedule data for this month</span>
                            )}
                            <button type="button" className="sb-month-clear" onClick={clearSelection}>
                                Show holidays only
                            </button>
                        </>
                    ) : (
                        <>
                            <span className="sb-month-hint">
                                Showing this month's holidays only — a month of shifts for everyone at once
                                would bury the calendar. Search, or pick, a single employee to see their
                                schedule on it.
                            </span>
                            <span className="sb-month-status">
                                {rosterLoading ? 'Loading employees…' : `${monthMatches.length} match this search`}
                            </span>
                            {!rosterLoading && monthMatches.length > 1 && (
                                <select
                                    className="board-type-select sb-month-picker"
                                    value=""
                                    onChange={(e) => setPinnedEmployeeId(e.target.value ? Number(e.target.value) : null)}
                                    aria-label="Pick the employee to show on the calendar"
                                >
                                    <option value="">Pick an employee…</option>
                                    {monthMatches.map(emp => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.name}{emp.team ? ` — ${emp.team}` : ''}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </>
                    )}
                </div>
            )}

            <div className="board-main-area">
                {isMonth ? (
                    error
                        ? <div className="error-state sb-month-error">⚠️ {error}</div>
                        : renderMonthCalendar()
                ) : (
                <div className="table-outer-wrapper">
                    <table className="schedule-table">
                        <thead>
                            <tr>
                                <th className="sticky-col emp-header-cell">Employees / Team</th>
                                <th className="weekly-hours-header">Weekly Hours</th>
                                {weekDates.map(date => (
                                    <th key={date} className={isToday(date) ? 'today-col-header' : ''}>
                                        <div className="day-header-content">
                                            <span className="day-name">{new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</span>
                                            <span className="day-date">{new Date(date + 'T12:00:00').getDate()}</span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan="9" className="loading-state">
                                    <div className="spinner"></div>
                                    Loading schedule data...
                                </td></tr>
                            ) : error ? (
                                <tr><td colSpan="9" className="error-state">⚠️ {error}</td></tr>
                            ) : filteredData.length === 0 ? (
                                <tr><td colSpan="9" className="empty-state">
                                    {typeFilter === 'all'
                                        ? 'NO DATA FOUND FOR THIS WEEK'
                                        : `NO ${SCHEDULE_TYPES.find(t => t.id === typeFilter).label.toUpperCase()} DAYS THIS WEEK`}
                                </td></tr>
                            ) : (
                                filteredData.map(emp => (
                                    <tr key={emp.id}>
                                        <td className="sticky-col emp-cell">
                                            <div className="emp-cell-inner">
                                                <div className="emp-card-info">
                                                    <span className="emp-name-text">{emp.name}</span>
                                                    <span className="emp-team-text">{emp.team || 'Unassigned'}</span>
                                                </div>
                                                {onEditSchedule && (
                                                    <button
                                                        type="button"
                                                        className="emp-edit-btn"
                                                        onClick={() => onEditSchedule(emp)}
                                                        title={`Edit ${emp.name}'s schedule in Shift Management`}
                                                        aria-label={`Edit ${emp.name}'s schedule`}
                                                    >
                                                        <IconEditSchedule />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td className="weekly-hours-cell">{calcWeeklyHours(emp).toFixed(2)}</td>
                                        {weekDates.map(date => {
                                            const schedule = emp.schedules[date];
                                            const todayClass = isToday(date) ? 'is-today-cell' : '';
                                            // Filtered-out days keep their cell so the week stays aligned across
                                            // rows, but show a placeholder instead of the card. Rendering nothing
                                            // at all would read as "no schedule", which is the opposite of true.
                                            if (!dayMatchesType(schedule)) {
                                                return (
                                                    <td key={date} className={`schedule-cell schedule-cell-filtered ${todayClass}`}>
                                                        <span
                                                            className="shift-filtered-out"
                                                            title={`Hidden by the ${SCHEDULE_TYPES.find(t => t.id === typeFilter).label} filter`}
                                                        >
                                                            —
                                                        </span>
                                                    </td>
                                                );
                                            }
                                            return (
                                                <td key={date} className={`schedule-cell ${todayClass}`}>
                                                    <ShiftCard schedule={schedule} lunchHours={lunchHoursOn(emp, date)} />
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                )}
            </div>
        </div>
    );
};

export default ScheduleBoard;
