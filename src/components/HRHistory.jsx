import React, { useCallback, useEffect, useState } from 'react';
import './ScheduleBoard.css';
import './ScheduleForecastSettings.css';
import './HRHistory.css';

/**
 * HR > History — every change made in the Bonus module, newest first.
 *
 * One line per changed field, which is how the question gets asked: not "who touched that
 * row" but "who moved her to that team", "who raised that amount". A create and a delete are
 * single lines, since the whole row is the change.
 *
 * Read-only, and there is no endpoint that could make it otherwise. Nothing here can be
 * edited or cleared from the UI — a log that can be rewritten answers nothing.
 */

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const ACTIONS = [
    { id: '', label: 'All changes' },
    { id: 'create', label: 'Added' },
    { id: 'update', label: 'Edited' },
    { id: 'delete', label: 'Removed' },
    { id: 'setting', label: 'Settings' }
];

const ACTION_LABEL = {
    create: 'Added',
    update: 'Edited',
    delete: 'Removed',
    setting: 'Setting'
};

const PAGE_SIZE = 100;

/** "2 Sep 2026, 14:32" — the MySQL timestamp is already in the platform's timezone. */
const formatWhen = (value) => {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
};

const HRHistory = () => {
    const now = new Date();
    const [year, setYear] = useState('');
    const [month, setMonth] = useState('');
    const [action, setAction] = useState('');
    const [search, setSearch] = useState('');
    const [entries, setEntries] = useState([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // A window either side of today: far enough back for last year's payroll, one ahead for
    // a month somebody has started planning.
    const yearOptions = [now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1];

    const load = useCallback(async (nextOffset, { append = false } = {}) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ limit: PAGE_SIZE, offset: nextOffset });
            if (year) params.set('year', year);
            if (month) params.set('month', month);
            if (action) params.set('action', action);
            if (search.trim()) params.set('search', search.trim());

            const res = await fetch(`./api/get_bonus_audit_log.php?${params}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not load the history.');

            setTotal(json.total || 0);
            setOffset(nextOffset);
            setEntries(current => (append ? [...current, ...(json.data || [])] : (json.data || [])));
        } catch (err) {
            setError(err.message);
            if (!append) setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [year, month, action, search]);

    // Any filter change starts the list over from the top rather than paging into a set that
    // no longer matches what is on screen.
    useEffect(() => {
        load(0);
    }, [load]);

    const hasMore = entries.length < total;

    return (
        <div className="schedule-board-container">
            <header className="board-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1>HR</h1>
                        <span className="badge">History</span>
                    </div>
                    <div className="week-range-label">
                        Every change made to the Bonus lists — who made it, and when.
                    </div>
                </div>
            </header>

            <div className="hr-history-toolbar">
                <div className="search-box hr-history-search">
                    <span className="search-icon">🔍</span>
                    <input
                        type="text"
                        placeholder="Employee, user or field…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <select className="bonus-select" value={month} onChange={(e) => setMonth(e.target.value)} title="Bonus month">
                    <option value="">Any month</option>
                    {MONTHS.map((name, index) => (
                        <option key={name} value={index + 1}>{name}</option>
                    ))}
                </select>

                <select className="bonus-select" value={year} onChange={(e) => setYear(e.target.value)} title="Bonus year">
                    <option value="">Any year</option>
                    {yearOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </select>

                <select className="bonus-select" value={action} onChange={(e) => setAction(e.target.value)} title="Kind of change">
                    {ACTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>

                <span className="hr-history-count">
                    {total} {total === 1 ? 'change' : 'changes'}
                </span>
            </div>

            {error && <div className="company-banner is-error">{error}</div>}

            <div className="hr-history-table-wrapper">
                <table className="hr-history-table">
                    <thead>
                        <tr>
                            <th className="hr-history-col-when">When</th>
                            <th className="hr-history-col-user">User</th>
                            <th className="hr-history-col-emp">Employee</th>
                            <th className="hr-history-col-period">Period</th>
                            <th className="hr-history-col-action">Change</th>
                            <th>Detail</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map(entry => (
                            <tr key={entry.id}>
                                <td className="hr-history-when">{formatWhen(entry.created_at)}</td>
                                <td className="hr-history-user">{entry.user_name || '—'}</td>
                                <td>{entry.employee_name || <span className="hr-history-muted">—</span>}</td>
                                <td className="hr-history-period">
                                    {entry.period_month
                                        ? `${MONTHS[entry.period_month - 1].slice(0, 3)} ${entry.period_year}`
                                        : <span className="hr-history-muted">—</span>}
                                </td>
                                <td>
                                    <span className={`hr-history-badge is-${entry.action}`}>
                                        {ACTION_LABEL[entry.action] || entry.action}
                                    </span>
                                </td>
                                <td className="hr-history-detail">
                                    {entry.action === 'update' || entry.action === 'setting' ? (
                                        <>
                                            <span className="hr-history-field">{entry.field}</span>
                                            <span className="hr-history-from">
                                                {entry.old_value || <em>empty</em>}
                                            </span>
                                            <span className="hr-history-arrow">→</span>
                                            <span className="hr-history-to">
                                                {entry.new_value || <em>empty</em>}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="hr-history-summary">
                                            {entry.new_value || entry.old_value || '—'}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}

                        {entries.length === 0 && !loading && (
                            <tr>
                                <td colSpan={6} className="hr-history-empty">
                                    No changes match these filters.
                                </td>
                            </tr>
                        )}
                        {loading && entries.length === 0 && (
                            <tr>
                                <td colSpan={6} className="hr-history-empty">Loading the history…</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {hasMore && (
                <div className="hr-history-more">
                    <button
                        className="company-reset-btn"
                        onClick={() => load(offset + PAGE_SIZE, { append: true })}
                        disabled={loading}
                    >
                        {loading ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, total - entries.length)} more`}
                    </button>
                </div>
            )}
        </div>
    );
};

export default HRHistory;
