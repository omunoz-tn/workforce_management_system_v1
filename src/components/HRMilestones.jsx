import { useCallback, useEffect, useMemo, useState } from 'react';
import './ScheduleBoard.css';
import './DashboardSettings.css';
// .search-box / .search-input / .clear-search-btn / .export-csv-btn live here and are
// shared across the app; imported explicitly rather than relied on from another screen's
// bundle.
import './AllEmployees.css';
import './HRMilestones.css';
import LoadingScreen from './LoadingScreen';
import MilestonesPdfDesigner from './MilestonesPdfDesigner';
import { normalizeForSearch } from '../utils/search';
// Wording and ordering shared with the PDF designer, so the two presentations of the
// same milestone can never disagree.
import { MONTHS, milestoneLabel, chronological, dayLabel } from '../utils/milestones';

/**
 * HR > Milestones — whose birthday and whose work anniversary falls in a given month.
 *
 * Everything comes from odoo_employee_data through get_hr_milestones.php; there is no
 * second employee list here. That endpoint returns the whole year, and this screen narrows
 * it: normally to the selected month, and to matching names when somebody is searched for.
 * The tabs pick which arrays to show and the Grid/List switch picks how, both reading the
 * same `visible` list below — the two views must never be able to disagree about who is in
 * the month.
 *
 * Searching deliberately escapes the month. Looking an employee up is how you find out
 * *when* their birthday is, so a search confined to the month already on screen would
 * answer "nothing found" nearly every time. While a search is active the entries therefore
 * carry their month, since the selector is no longer providing that context.
 *
 * The year is the thing this screen is careful never to show. Neither a birth year nor a
 * hire year reaches the browser at all (see the endpoint), and outside of search the month
 * is named once, in the selector, so each entry needs only its day number.
 */

const TABS = [
    { id: 'all', label: 'All' },
    { id: 'birthdays', label: 'Birthdays' },
    { id: 'anniversaries', label: 'Anniversaries' }
];

/** The platform's large switch, with its label as part of the click target. */
const MilestoneToggle = ({ label, checked, onChange }) => (
    <div
        className="milestone-toggle"
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onChange(!checked);
            }
        }}
    >
        <span className="milestone-toggle-label">{label}</span>
        <div className={`toggle-switch large ${checked ? 'on' : 'off'}`}>
            <div className="switch-slider"></div>
        </div>
    </div>
);

const HRMilestones = () => {
    const today = new Date();
    const [month, setMonth] = useState(today.getMonth() + 1);
    const [year, setYear] = useState(today.getFullYear());
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState('all');
    const [view, setView] = useState('grid');
    // Both off by default: age and exact tenure are opt-in.
    const [showAge, setShowAge] = useState(false);
    const [showTenure, setShowTenure] = useState(false);
    const [designing, setDesigning] = useState(false);
    // Employees taken out of this month's list by hand. Deliberately nothing more than
    // component state: leaving HR > Milestones unmounts this screen, so the exclusions die
    // with it and everyone is back the next time it is opened. Nothing is written to the
    // database -- an employee hidden from a poster has not left the company.
    const [hidden, setHidden] = useState(() => new Set());
    const [data, setData] = useState({ birthdays: [], anniversaries: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // A window either side of the current year, the same shape HR > History uses.
    const yearOptions = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];

    // Only the year is fetched: ages and years of service are relative to it, while the
    // month and the search are both filters over what comes back. Walking months therefore
    // costs nothing.
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`./api/get_hr_milestones.php?year=${year}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not load milestones.');
            setData({ birthdays: json.birthdays || [], anniversaries: json.anniversaries || [] });
        } catch (err) {
            setError(err.message);
            setData({ birthdays: [], anniversaries: [] });
        } finally {
            setLoading(false);
        }
    }, [year]);

    useEffect(() => {
        load();
    }, [load]);

    const goToMonth = (direction) => {
        // Date does the year rollover, so December + 1 lands on January of the next year
        // instead of month 13.
        const moved = new Date(year, month - 1 + direction, 1);
        setMonth(moved.getMonth() + 1);
        setYear(moved.getFullYear());
    };

    const goToToday = () => {
        const now = new Date();
        setMonth(now.getMonth() + 1);
        setYear(now.getFullYear());
    };

    // Every token has to match somewhere in the name, so "juan garcia" finds "Juan Carlos
    // Rijo Garcia" whatever order the parts were typed in. normalizeForSearch strips the
    // diacritics from both sides, which is what lets "munoz" find "Muñoz".
    const searchTokens = useMemo(() => (
        normalizeForSearch(search.trim()).split(/\s+/).filter(Boolean)
    ), [search]);

    const isSearching = searchTokens.length > 0;

    // The one place the removals are applied. Everything downstream -- the tabs, the grid,
    // the list, the CSV and the PDF designer -- reads from here, so a hidden employee
    // cannot come back through one of them.
    const kept = useMemo(() => ({
        birthdays: data.birthdays.filter(item => !hidden.has(item.employee_id)),
        anniversaries: data.anniversaries.filter(item => !hidden.has(item.employee_id))
    }), [data, hidden]);

    // The selected month on its own. Kept separate from `scoped` because the PDF designer
    // prints the month, never the search results: a poster of "everyone called Muñoz" is
    // not a thing anyone wants on the wall.
    const monthScoped = useMemo(() => ({
        birthdays: kept.birthdays.filter(item => item.month === month),
        anniversaries: kept.anniversaries.filter(item => item.month === month)
    }), [kept, month]);

    const scoped = useMemo(() => {
        if (!isSearching) return monthScoped;

        const narrow = (list) => list.filter(item => {
            const haystack = normalizeForSearch(item.name);
            return searchTokens.every(token => haystack.includes(token));
        });

        return {
            birthdays: narrow(kept.birthdays),
            anniversaries: narrow(kept.anniversaries)
        };
    }, [kept, monthScoped, isSearching, searchTokens]);

    // The single ordered dataset every view renders.
    const visible = useMemo(() => {
        const chosen = tab === 'birthdays' ? scoped.birthdays
            : tab === 'anniversaries' ? scoped.anniversaries
                : [...scoped.birthdays, ...scoped.anniversaries];

        return chosen.slice().sort(chronological);
    }, [tab, scoped]);

    const counts = {
        all: scoped.birthdays.length + scoped.anniversaries.length,
        birthdays: scoped.birthdays.length,
        anniversaries: scoped.anniversaries.length
    };

    const emptyMessage = isSearching
        ? `No milestones found for “${search.trim()}”.`
        : tab === 'birthdays'
            ? 'No birthdays this month.'
            : tab === 'anniversaries'
                ? 'No work anniversaries this month.'
                : 'No milestones for this month.';

    const removeEmployee = (item) => setHidden(current => {
        const next = new Set(current);
        next.add(item.employee_id);
        return next;
    });

    const restoreAll = () => setHidden(new Set());

    const exportCSV = () => {
        // Exports exactly what is on screen: same tab, same scope, and the age column only
        // when the toggle has been turned on. The month joins it while searching, for the
        // same reason the cards show it. The year is absent here for the same reason it is
        // absent from the cards.
        const headers = isSearching ? ['Month', 'Day', 'Employee', 'Milestone'] : ['Day', 'Employee', 'Milestone'];
        if (showAge) headers.push('Age');

        const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = visible.map(item => {
            const cells = isSearching ? [MONTHS[item.month - 1]] : [];
            cells.push(dayLabel(item.day), item.name, milestoneLabel(item, showTenure));
            if (showAge) cells.push(item.type === 'birthday' && item.age ? item.age : '');
            return cells.map(escape).join(',');
        });

        const csv = [headers.map(escape).join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = isSearching
            ? `Milestones_${year}_search.csv`
            : `Milestones_${MONTHS[month - 1]}_${year}.csv`;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const renderAge = (item) => (
        showAge && item.type === 'birthday' && item.age
            ? <span className="milestone-age">{item.age} years old</span>
            : null
    );

    return (
        <div className="schedule-board-container">
            <header className="board-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1>HR</h1>
                        <span className="badge">Milestones</span>
                    </div>
                    <div className="week-range-label">
                        Employee birthdays and work anniversaries
                    </div>
                </div>
            </header>

            <div className="milestone-toolbar">
                <div className="milestone-toolbar-group">
                    <div className="search-box milestone-search">
                        <span className="search-icon">🔍</span>
                        <input
                            type="text"
                            className="search-input"
                            placeholder="Search employee…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                            <button
                                className="clear-search-btn"
                                onClick={() => setSearch('')}
                                title="Clear search"
                            >✕</button>
                        )}
                    </div>

                    {/* Disabled rather than hidden while searching: the controls stay where
                        they were so clearing the box puts you back, and greying them out is
                        what says the month no longer applies. */}
                    <div className="milestone-period-nav navigation-controls">
                        <button
                            className="nav-btn prev"
                            onClick={() => goToMonth(-1)}
                            disabled={isSearching}
                            title="Previous month"
                        >←</button>
                        <button
                            className="nav-btn today"
                            onClick={goToToday}
                            disabled={isSearching}
                        >Today</button>
                        <button
                            className="nav-btn next"
                            onClick={() => goToMonth(1)}
                            disabled={isSearching}
                            title="Next month"
                        >→</button>
                    </div>

                    <select
                        className="milestone-select"
                        value={month}
                        onChange={(e) => setMonth(Number(e.target.value))}
                        disabled={isSearching}
                        aria-label="Month"
                    >
                        {MONTHS.map((name, index) => (
                            <option key={name} value={index + 1}>{name}</option>
                        ))}
                    </select>

                    <select
                        className="milestone-select"
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        aria-label="Year"
                    >
                        {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                </div>

                <div className="milestone-toolbar-group">
                    <MilestoneToggle label="Show Age" checked={showAge} onChange={setShowAge} />
                    <MilestoneToggle label="Tenure" checked={showTenure} onChange={setShowTenure} />

                    <div className="milestone-view-toggle navigation-controls">
                        <button
                            className={`nav-btn ${view === 'grid' ? 'today' : ''}`}
                            onClick={() => setView('grid')}
                        >▦ Grid</button>
                        <button
                            className={`nav-btn ${view === 'list' ? 'today' : ''}`}
                            onClick={() => setView('list')}
                        >☷ List</button>
                    </div>

                    <button
                        className="export-csv-btn milestone-export-btn"
                        onClick={() => setDesigning(true)}
                        title="Open the print layout editor for this month"
                    >
                        Design PDF
                    </button>

                    <button
                        className="export-csv-btn milestone-export-btn"
                        onClick={exportCSV}
                        disabled={visible.length === 0}
                        title="Export the visible milestones to CSV"
                    >
                        Export CSV
                    </button>
                </div>
            </div>

            <div className="milestone-tabs">
                {TABS.map(item => (
                    <button
                        key={item.id}
                        className={`milestone-tab ${tab === item.id ? 'is-active' : ''}`}
                        onClick={() => setTab(item.id)}
                    >
                        {item.label}
                        <span className="milestone-tab-count">{counts[item.id]}</span>
                    </button>
                ))}

                {isSearching && (
                    <span className="milestone-search-scope">
                        Searching all of {year} — the month selector does not apply
                    </span>
                )}
            </div>

            {hidden.size > 0 && (
                <div className="milestone-hidden-bar">
                    <span>
                        {hidden.size} employee{hidden.size === 1 ? '' : 's'} removed from this list —
                        hidden from the grid, the list, the CSV and the PDF. They come back on their
                        own when you leave Milestones.
                    </span>
                    <button className="milestone-restore-btn" onClick={restoreAll}>Restore all</button>
                </div>
            )}

            {error && (
                <div className="milestone-error">
                    <strong>Error:</strong> {error}
                </div>
            )}

            <LoadingScreen loading={loading} message="Loading Milestones" />

            {/* The page shell is a fixed-height flex column with overflow hidden, so the
                results need their own scroll region or a long month is simply clipped at
                the bottom of the screen, mid-card. */}
            {!loading && !error && (
                <div className="milestone-results">
                    {visible.length === 0 ? (
                        <div className="milestone-empty">
                            {emptyMessage}
                            {isSearching && (
                                <span className="milestone-empty-hint">
                                    Employees with no date of birth and no hire date on file never appear here.
                                </span>
                            )}
                        </div>
                    ) : view === 'grid' ? (
                        <div className="milestone-grid">
                            {visible.map(item => (
                                <article
                                    key={`${item.type}-${item.employee_id}-${item.month}-${item.day}`}
                                    className={`milestone-card is-${item.type}`}
                                >
                                    <span className="milestone-icon">{item.type === 'birthday' ? '🎂' : '🏆'}</span>
                                    {isSearching && (
                                        <span className="milestone-month">{MONTHS[item.month - 1]}</span>
                                    )}
                                    <span className="milestone-day">{dayLabel(item.day)}</span>
                                    <span className="milestone-name">{item.name}</span>
                                    <span className="milestone-type">{milestoneLabel(item, showTenure)}</span>
                                    {renderAge(item)}
                                    <button
                                        className="milestone-remove"
                                        onClick={() => removeEmployee(item)}
                                        title={`Remove ${item.name} from this list`}
                                        aria-label={`Remove ${item.name} from this list`}
                                    >✕</button>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="milestone-list-wrapper">
                            <table className="milestone-list">
                                <tbody>
                                    {visible.map(item => (
                                        <tr
                                            key={`${item.type}-${item.employee_id}-${item.month}-${item.day}`}
                                            className={`is-${item.type}`}
                                        >
                                            <td className="milestone-list-day">
                                                {dayLabel(item.day)}
                                                {isSearching && (
                                                    <span className="milestone-list-month">
                                                        {MONTHS[item.month - 1].slice(0, 3)}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="milestone-list-name">{item.name}</td>
                                            <td className="milestone-list-type">
                                                <span className="milestone-icon-inline">
                                                    {item.type === 'birthday' ? '🎂' : '🏆'}
                                                </span>
                                                {milestoneLabel(item, showTenure)}
                                                {renderAge(item)}
                                            </td>
                                            <td className="milestone-list-remove">
                                                <button
                                                    className="milestone-remove"
                                                    onClick={() => removeEmployee(item)}
                                                    title={`Remove ${item.name} from this list`}
                                                    aria-label={`Remove ${item.name} from this list`}
                                                >✕</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {designing && (
                <MilestonesPdfDesigner
                    birthdays={monthScoped.birthdays}
                    anniversaries={monthScoped.anniversaries}
                    month={month}
                    year={year}
                    onChangeMonth={setMonth}
                    onClose={() => setDesigning(false)}
                />
            )}
        </div>
    );
};

export default HRMilestones;
