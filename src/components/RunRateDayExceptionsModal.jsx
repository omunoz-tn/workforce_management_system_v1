import { todayStr as currentDateStr } from '../utils/dates';
import React, { useState, useEffect, useMemo } from 'react';
import './Teams.css';
import './ReportSettings.css';
import './ScheduleBoard.css';
import './RunRateDayExceptionsModal.css';
import RunRateEmployeeDayExceptionsModal from './RunRateEmployeeDayExceptionsModal';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAY_HEADERS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export const todayStr = currentDateStr();

export const getCalendarCells = (anchorDate) => {
    const year = anchorDate.getFullYear();
    const month = anchorDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
        cells.push(new Date(year, month, day).toISOString().split('T')[0]);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
};

/**
 * Everyone the pickers should list for a team: the employees with Run Rate rows this
 * month (which includes people DeskTime groups into the team without an assignment), plus
 * everyone assigned to the team. The month's rows alone missed people with no row in it,
 * for example someone whose days were all excluded after they left, while the projection
 * still gave them a shift and there was no way to exclude them.
 *
 * Resolves to { employees: [{ employee_id, name }] sorted by name, excludedIds: Set }.
 * Ids are numbers throughout, so Set lookups match whichever source a row came from.
 */
const loadTeamEmployees = async (team) => {
    const [stats, members, exceptions] = await Promise.all([
        fetch('./api/get_dashboard_stats.php').then(res => res.json()),
        fetch(`./api/get_team_members.php?team_id=${team.id}`).then(res => res.json()).catch(() => null),
        fetch('./api/manage_run_rate_exceptions.php').then(res => res.json()).catch(() => null),
    ]);

    const byId = new Map();
    (stats?.mtdEmployeeData || [])
        .filter(row => row.team_name === team.name)
        .forEach(row => byId.set(Number(row.employee_id), { employee_id: Number(row.employee_id), name: row.name }));
    (members?.members || []).forEach(m => {
        const id = Number(m.employee_id);
        if (!byId.has(id)) byId.set(id, { employee_id: id, name: m.name });
    });

    const excludedIds = new Set((exceptions?.excluded_employee_ids || []).map(Number));
    (stats?.mtdEmployeeData || [])
        .filter(row => row.team_name === team.name && Number(row.is_excluded))
        .forEach(row => excludedIds.add(Number(row.employee_id)));

    const employees = [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { employees, excludedIds };
};

// The single "Exceptions" entry point for a team's Run Rate. Three top-level
// tabs: "Days Exceptions" (calendar — excludes specific dates, team-wide or
// for one employee only), "Employees Exceptions" (excludes specific employees
// entirely, every day) and "Time Exceptions" (minutes swallowed at the start of
// every shift). Each writes to its own table, so they never conflict with each
// other.
const RunRateDayExceptionsModal = ({ team, onClose }) => {
    const [topTab, setTopTab] = useState('days'); // 'days' | 'employees' | 'time'

    // --- Days Exceptions (calendar) ---
    const [excludedDates, setExcludedDates] = useState(new Set());
    const [anchorDate, setAnchorDate] = useState(new Date());
    const [loadingDays, setLoadingDays] = useState(true);
    const [daysSaveStatus, setDaysSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

    // 'team' = team-wide day exceptions; 'byEmployee' = pick one employee
    // (excluding anyone already fully excluded via Employees Exceptions —
    // they don't need a per-day picker) to set day exceptions that apply
    // ONLY to that employee, not the rest of the team.
    const [dayScope, setDayScope] = useState('team');
    const [dayScopeEmployees, setDayScopeEmployees] = useState([]);
    const [loadingDayScopeEmployees, setLoadingDayScopeEmployees] = useState(false);
    const [employeeDayModalFor, setEmployeeDayModalFor] = useState(null);

    // --- Employees Exceptions (whole-employee include/exclude) ---
    const [excEmployees, setExcEmployees] = useState([]);
    const [excludedEmployeeIds, setExcludedEmployeeIds] = useState(new Set());
    const [excSearchTerm, setExcSearchTerm] = useState('');
    const [loadingExcEmployees, setLoadingExcEmployees] = useState(true);
    const [excSaveStatus, setExcSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
    const [excEmployeesLoaded, setExcEmployeesLoaded] = useState(false);

    // --- Time Exceptions (minutes discounted from the start of every shift) ---
    // 'team' = the team's base value; 'byEmployee' = per-employee overrides of
    // it. An empty box means "inherit the team", which is why the overrides are
    // kept as strings rather than numbers — '' and '0' mean different things.
    const [timeScope, setTimeScope] = useState('team');
    const [teamMinutes, setTeamMinutes] = useState('0');
    const [timeOverrides, setTimeOverrides] = useState({}); // { [employee_id]: string }
    const [timeEmployees, setTimeEmployees] = useState([]);
    const [timeSearchTerm, setTimeSearchTerm] = useState('');
    const [loadingTime, setLoadingTime] = useState(true);
    const [loadingTimeEmployees, setLoadingTimeEmployees] = useState(false);
    const [timeLoaded, setTimeLoaded] = useState(false);
    const [timeEmployeesLoaded, setTimeEmployeesLoaded] = useState(false);
    const [timeSaveStatus, setTimeSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
    const [timeError, setTimeError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoadingDays(true);
        fetch(`./api/manage_run_rate_excluded_days.php?team_id=${team.id}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (json.success) setExcludedDates(new Set(json.excluded_dates || []));
            })
            .catch(err => console.error('Failed to load run rate day exceptions', err))
            .finally(() => { if (!cancelled) setLoadingDays(false); });
        return () => { cancelled = true; };
    }, [team]);

    useEffect(() => {
        if (dayScope !== 'byEmployee') return;
        let cancelled = false;
        setLoadingDayScopeEmployees(true);
        loadTeamEmployees(team)
            .then(({ employees, excludedIds }) => {
                if (cancelled) return;
                setDayScopeEmployees(employees.filter(emp => !excludedIds.has(emp.employee_id)));
            })
            .catch(err => console.error('Failed to load team employees', err))
            .finally(() => { if (!cancelled) setLoadingDayScopeEmployees(false); });
        return () => { cancelled = true; };
    }, [dayScope, team]);

    useEffect(() => {
        if (topTab !== 'employees' || excEmployeesLoaded) return;
        let cancelled = false;
        setLoadingExcEmployees(true);
        loadTeamEmployees(team)
            .then(({ employees, excludedIds }) => {
                if (cancelled) return;
                setExcEmployees(employees);
                setExcludedEmployeeIds(new Set(employees.filter(emp => excludedIds.has(emp.employee_id)).map(emp => emp.employee_id)));
                setExcEmployeesLoaded(true);
            })
            .catch(err => console.error('Failed to load run rate exceptions', err))
            .finally(() => { if (!cancelled) setLoadingExcEmployees(false); });
        return () => { cancelled = true; };
    }, [topTab, team, excEmployeesLoaded]);

    useEffect(() => {
        if (topTab !== 'time' || timeLoaded) return;
        let cancelled = false;
        setLoadingTime(true);
        fetch(`./api/manage_run_rate_time_exceptions.php?team_id=${team.id}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (!json.success) return;
                setTeamMinutes(String(json.team_minutes ?? 0));
                const initial = {};
                (json.overrides || []).forEach(row => {
                    initial[row.employee_id] = String(row.exception_minutes);
                });
                setTimeOverrides(initial);
                setTimeLoaded(true);
            })
            .catch(err => console.error('Failed to load run rate time exceptions', err))
            .finally(() => { if (!cancelled) setLoadingTime(false); });
        return () => { cancelled = true; };
    }, [topTab, team, timeLoaded]);

    useEffect(() => {
        if (topTab !== 'time' || timeScope !== 'byEmployee' || timeEmployeesLoaded) return;
        let cancelled = false;
        setLoadingTimeEmployees(true);
        loadTeamEmployees(team)
            .then(({ employees }) => {
                if (cancelled) return;
                setTimeEmployees(employees);
                setTimeEmployeesLoaded(true);
            })
            .catch(err => console.error('Failed to load team employees', err))
            .finally(() => { if (!cancelled) setLoadingTimeEmployees(false); });
        return () => { cancelled = true; };
    }, [topTab, timeScope, team, timeEmployeesLoaded]);

    const toggleDate = (dateStr) => {
        setExcludedDates(prev => {
            const next = new Set(prev);
            if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
            return next;
        });
        setDaysSaveStatus(null);
    };

    const navigateMonth = (direction) => {
        const d = new Date(anchorDate);
        d.setMonth(d.getMonth() + direction);
        setAnchorDate(d);
    };

    const handleSaveDays = async () => {
        setDaysSaveStatus('saving');
        try {
            const res = await fetch('./api/manage_run_rate_excluded_days.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ team_id: team.id, excluded_dates: [...excludedDates] })
            });
            const json = await res.json();
            setDaysSaveStatus(json.success ? 'saved' : 'error');
        } catch (err) {
            console.error('Failed to save run rate day exceptions', err);
            setDaysSaveStatus('error');
        }
    };

    const toggleEmployeeExclusion = (employeeId) => {
        setExcludedEmployeeIds(prev => {
            const next = new Set(prev);
            if (next.has(employeeId)) next.delete(employeeId); else next.add(employeeId);
            return next;
        });
        setExcSaveStatus(null);
    };

    const includeAllEmployees = () => { setExcludedEmployeeIds(new Set()); setExcSaveStatus(null); };
    const excludeAllEmployees = () => { setExcludedEmployeeIds(new Set(excEmployees.map(emp => emp.employee_id))); setExcSaveStatus(null); };

    const filteredExcEmployees = useMemo(() => {
        const term = excSearchTerm.toLowerCase();
        return excEmployees.filter(emp => emp.name.toLowerCase().includes(term));
    }, [excEmployees, excSearchTerm]);

    const handleSaveEmployees = async () => {
        setExcSaveStatus('saving');
        try {
            const res = await fetch('./api/manage_run_rate_exceptions.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employee_ids: excEmployees.map(emp => emp.employee_id),
                    excluded_employee_ids: [...excludedEmployeeIds]
                })
            });
            const json = await res.json();
            setExcSaveStatus(json.success ? 'saved' : 'error');
        } catch (err) {
            console.error('Failed to save run rate exceptions', err);
            setExcSaveStatus('error');
        }
    };

    const handleTimeOverrideChange = (employeeId, value) => {
        setTimeOverrides(prev => ({ ...prev, [employeeId]: value }));
        setTimeSaveStatus(null);
        setTimeError(null);
    };

    const filteredTimeEmployees = useMemo(() => {
        const term = timeSearchTerm.toLowerCase();
        return timeEmployees.filter(emp => emp.name.toLowerCase().includes(term));
    }, [timeEmployees, timeSearchTerm]);

    const isValidMinutes = (value) => {
        const parsed = Number(value);
        return value !== '' && Number.isInteger(parsed) && parsed >= 0 && parsed <= 1440;
    };

    const handleSaveTeamTime = async () => {
        if (!isValidMinutes(teamMinutes)) {
            setTimeSaveStatus('error');
            setTimeError('Enter a whole number of minutes between 0 and 1440.');
            return;
        }

        setTimeSaveStatus('saving');
        setTimeError(null);
        try {
            const res = await fetch('./api/manage_run_rate_time_exceptions.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ team_id: team.id, team_minutes: Number(teamMinutes) })
            });
            const json = await res.json();
            setTimeSaveStatus(json.success ? 'saved' : 'error');
            if (!json.success) setTimeError(json.error || 'Failed to save.');
        } catch (err) {
            console.error('Failed to save run rate time exceptions', err);
            setTimeSaveStatus('error');
            setTimeError('Failed to save.');
        }
    };

    const handleSaveEmployeeTime = async () => {
        // Only employees with a value entered get a row; the rest inherit the team.
        const overrides = timeEmployees
            .filter(emp => (timeOverrides[emp.employee_id] ?? '') !== '')
            .map(emp => ({ employee_id: emp.employee_id, exception_minutes: timeOverrides[emp.employee_id] }));

        const invalid = overrides.find(entry => !isValidMinutes(entry.exception_minutes));
        if (invalid) {
            setTimeSaveStatus('error');
            setTimeError('Every override must be a whole number of minutes between 0 and 1440.');
            return;
        }

        setTimeSaveStatus('saving');
        setTimeError(null);
        try {
            const res = await fetch('./api/manage_run_rate_time_exceptions.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    team_id: team.id,
                    employee_ids: timeEmployees.map(emp => emp.employee_id),
                    overrides: overrides.map(entry => ({ ...entry, exception_minutes: Number(entry.exception_minutes) }))
                })
            });
            const json = await res.json();
            setTimeSaveStatus(json.success ? 'saved' : 'error');
            if (!json.success) setTimeError(json.error || 'Failed to save.');
        } catch (err) {
            console.error('Failed to save run rate time exceptions', err);
            setTimeSaveStatus('error');
            setTimeError('Failed to save.');
        }
    };

    const cells = getCalendarCells(anchorDate);
    const weekCount = cells.length / 7;
    const includedEmployeeCount = excEmployees.length - excludedEmployeeIds.size;

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '680px', maxHeight: '92vh' }}>
                <div className="modal-header">
                    <div>
                        <h2>Exceptions</h2>
                        <p className="text-muted" style={{ margin: 0 }}>Team: {team.name}</p>
                    </div>
                    <div className="header-right-group">
                        {topTab === 'employees' && (
                            <div className="bulk-selection-links">
                                <span className="selection-link" onClick={includeAllEmployees}>Select All</span>
                                <span className="sep">|</span>
                                <span className="selection-link" onClick={excludeAllEmployees}>Deselect All</span>
                            </div>
                        )}
                        <button className="icon-btn" onClick={onClose} title="Close">✕</button>
                    </div>
                </div>

                <div className="modal-body">
                    <div className="day-exceptions-view-toggle navigation-controls">
                        <button
                            type="button"
                            className={`nav-btn ${topTab === 'days' ? 'today' : ''}`}
                            onClick={() => setTopTab('days')}
                        >
                            Days Exceptions
                        </button>
                        <button
                            type="button"
                            className={`nav-btn ${topTab === 'employees' ? 'today' : ''}`}
                            onClick={() => setTopTab('employees')}
                        >
                            Employees Exceptions
                        </button>
                        <button
                            type="button"
                            className={`nav-btn ${topTab === 'time' ? 'today' : ''}`}
                            onClick={() => setTopTab('time')}
                        >
                            Time Exceptions
                        </button>
                    </div>

                    {topTab === 'days' && (
                        <>
                            <div className="day-exceptions-view-toggle navigation-controls">
                                <button
                                    type="button"
                                    className={`nav-btn ${dayScope === 'team' ? 'today' : ''}`}
                                    onClick={() => setDayScope('team')}
                                >
                                    Team
                                </button>
                                <button
                                    type="button"
                                    className={`nav-btn ${dayScope === 'byEmployee' ? 'today' : ''}`}
                                    onClick={() => setDayScope('byEmployee')}
                                >
                                    Employee
                                </button>
                            </div>

                            {dayScope === 'team' ? (
                                <>
                                    <p className="text-muted">
                                        Click a day to exclude it from this team's Run Rate — e.g. a holiday the team
                                        didn't work but that shouldn't count against them. Click again to include it.
                                    </p>

                                    <div className="day-exceptions-nav navigation-controls">
                                        <button type="button" className="nav-btn prev" onClick={() => navigateMonth(-1)}>←</button>
                                        <button type="button" className="nav-btn today" onClick={() => setAnchorDate(new Date())}>Today</button>
                                        <button type="button" className="nav-btn next" onClick={() => navigateMonth(1)}>→</button>
                                        <span className="day-exceptions-month-label">
                                            {MONTH_NAMES[anchorDate.getMonth()]} {anchorDate.getFullYear()}
                                        </span>
                                    </div>

                                    {loadingDays ? (
                                        <p className="text-muted">Loading...</p>
                                    ) : (
                                        <div className="day-exceptions-calendar-grid" style={{ '--week-count': weekCount }}>
                                            {WEEKDAY_HEADERS.map(w => <div key={w} className="day-exceptions-weekday-header">{w}</div>)}
                                            {cells.map((dateStr, idx) => {
                                                if (!dateStr) return <div key={`blank-${idx}`} className="day-exceptions-cell is-empty" />;
                                                const dayNum = parseInt(dateStr.split('-')[2], 10);
                                                const excluded = excludedDates.has(dateStr);
                                                return (
                                                    <div
                                                        key={dateStr}
                                                        className={`day-exceptions-cell ${excluded ? 'is-excluded' : ''} ${dateStr === todayStr ? 'is-today' : ''}`}
                                                        onClick={() => toggleDate(dateStr)}
                                                        title={excluded ? 'Click to include this day again' : 'Click to exclude this day'}
                                                    >
                                                        <span className="day-exceptions-day-number">{dayNum}</span>
                                                        {excluded && <span className="day-exceptions-badge">Excluded</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p className="text-muted">
                                        Pick an employee to exclude specific days for them only — the rest of the team
                                        is unaffected. Employees already marked as an exception in "Employees Exceptions"
                                        don't need this and aren't listed here.
                                    </p>

                                    {loadingDayScopeEmployees ? (
                                        <p className="text-muted">Loading employees...</p>
                                    ) : dayScopeEmployees.length === 0 ? (
                                        <p className="text-muted">No employees to show for this team.</p>
                                    ) : (
                                        <div className="employee-selection-list">
                                            {dayScopeEmployees.map(emp => (
                                                <div
                                                    key={emp.employee_id}
                                                    className="employee-select-item"
                                                    onClick={() => setEmployeeDayModalFor(emp)}
                                                >
                                                    {emp.name}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {topTab === 'employees' && (
                        <>
                            <p className="text-muted">
                                Only selected employees count toward this team's Run Rate. Deselect an employee to
                                exclude them as an exception.
                            </p>
                            <input
                                type="text"
                                className="assignment-search"
                                placeholder="Search employees by name..."
                                value={excSearchTerm}
                                onChange={(e) => setExcSearchTerm(e.target.value)}
                            />
                            {loadingExcEmployees ? (
                                <p className="text-muted">Loading employees...</p>
                            ) : excEmployees.length === 0 ? (
                                <p className="text-muted">No employees found in this team.</p>
                            ) : (
                                <div className="employee-selection-list">
                                    {filteredExcEmployees.map(emp => (
                                        <div
                                            key={emp.employee_id}
                                            className={`employee-select-item ${excludedEmployeeIds.has(emp.employee_id) ? '' : 'selected'}`}
                                            onClick={() => toggleEmployeeExclusion(emp.employee_id)}
                                        >
                                            {emp.name}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {topTab === 'time' && (
                        <>
                            <div className="day-exceptions-view-toggle navigation-controls">
                                <button
                                    type="button"
                                    className={`nav-btn ${timeScope === 'team' ? 'today' : ''}`}
                                    onClick={() => setTimeScope('team')}
                                >
                                    Team
                                </button>
                                <button
                                    type="button"
                                    className={`nav-btn ${timeScope === 'byEmployee' ? 'today' : ''}`}
                                    onClick={() => setTimeScope('byEmployee')}
                                >
                                    Employee
                                </button>
                            </div>

                            {timeScope === 'team' ? (
                                <>
                                    <p className="text-muted">
                                        Minutes discounted from the START of every shift in this team before Run Rate
                                        is calculated — e.g. 15 minutes bills an 08:15-17:00 shift as 08:30-17:00.
                                        The scheduled hours drop by that much, and so does whatever DeskTime tracked
                                        inside those minutes. 0 means no exception.
                                    </p>

                                    {loadingTime ? (
                                        <p className="text-muted">Loading...</p>
                                    ) : (
                                        <div className="time-exceptions-team-field">
                                            <label htmlFor="time-exception-team-minutes">Time Exception</label>
                                            <div className="time-exceptions-input-group">
                                                <input
                                                    id="time-exception-team-minutes"
                                                    type="number"
                                                    min="0"
                                                    max="1440"
                                                    step="1"
                                                    className="time-exceptions-input"
                                                    value={teamMinutes}
                                                    onChange={(e) => {
                                                        setTeamMinutes(e.target.value);
                                                        setTimeSaveStatus(null);
                                                        setTimeError(null);
                                                    }}
                                                />
                                                <span className="time-exceptions-suffix">min</span>
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p className="text-muted">
                                        Overrides the team's value for one employee only. Leave a box empty to inherit
                                        the team's {teamMinutes || 0} min; type 0 to give an employee no exception at
                                        all.
                                    </p>
                                    <input
                                        type="text"
                                        className="assignment-search"
                                        placeholder="Search employees by name..."
                                        value={timeSearchTerm}
                                        onChange={(e) => setTimeSearchTerm(e.target.value)}
                                    />

                                    {loadingTimeEmployees ? (
                                        <p className="text-muted">Loading employees...</p>
                                    ) : timeEmployees.length === 0 ? (
                                        <p className="text-muted">No employees found in this team.</p>
                                    ) : (
                                        <div className="time-exceptions-list">
                                            {filteredTimeEmployees.map(emp => (
                                                <div key={emp.employee_id} className="time-exceptions-row">
                                                    <span className="time-exceptions-name">{emp.name}</span>
                                                    <div className="time-exceptions-input-group">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="1440"
                                                            step="1"
                                                            className="time-exceptions-input"
                                                            placeholder={teamMinutes || '0'}
                                                            value={timeOverrides[emp.employee_id] ?? ''}
                                                            onChange={(e) => handleTimeOverrideChange(emp.employee_id, e.target.value)}
                                                        />
                                                        <span className="time-exceptions-suffix">min</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}

                            {timeError && <p className="range-error">{timeError}</p>}
                        </>
                    )}
                </div>

                {topTab === 'days' && dayScope === 'team' && (
                    <div className="modal-footer">
                        <span style={{ marginRight: 'auto', fontSize: '0.9rem' }}>{excludedDates.size} day(s) excluded</span>
                        {daysSaveStatus === 'saved' && <span className="advance-config-status success">Saved.</span>}
                        {daysSaveStatus === 'error' && <span className="advance-config-status error">Failed to save. Try again.</span>}
                        <button onClick={onClose}>Cancel</button>
                        <button className="btn-primary" onClick={handleSaveDays} disabled={loadingDays || daysSaveStatus === 'saving'}>
                            {daysSaveStatus === 'saving' ? 'Saving...' : 'Save Exceptions'}
                        </button>
                    </div>
                )}

                {topTab === 'employees' && (
                    <div className="modal-footer">
                        <span style={{ marginRight: 'auto', fontSize: '0.9rem' }}>{includedEmployeeCount} of {excEmployees.length} counted</span>
                        {excSaveStatus === 'saved' && <span className="advance-config-status success">Saved.</span>}
                        {excSaveStatus === 'error' && <span className="advance-config-status error">Failed to save. Try again.</span>}
                        <button onClick={onClose}>Cancel</button>
                        <button className="btn-primary" onClick={handleSaveEmployees} disabled={loadingExcEmployees || excSaveStatus === 'saving'}>
                            {excSaveStatus === 'saving' ? 'Saving...' : 'Save Exceptions'}
                        </button>
                    </div>
                )}

                {topTab === 'time' && (
                    <div className="modal-footer">
                        {timeSaveStatus === 'saved' && <span className="advance-config-status success" style={{ marginRight: 'auto' }}>Saved.</span>}
                        {timeSaveStatus === 'error' && <span className="advance-config-status error" style={{ marginRight: 'auto' }}>Failed to save. Try again.</span>}
                        <button onClick={onClose}>Cancel</button>
                        <button
                            className="btn-primary"
                            onClick={timeScope === 'team' ? handleSaveTeamTime : handleSaveEmployeeTime}
                            disabled={loadingTime || timeSaveStatus === 'saving'}
                        >
                            {timeSaveStatus === 'saving' ? 'Saving...' : 'Save Time Exceptions'}
                        </button>
                    </div>
                )}
            </div>

            {employeeDayModalFor && (
                <RunRateEmployeeDayExceptionsModal
                    employee={employeeDayModalFor}
                    team={team}
                    onClose={() => setEmployeeDayModalFor(null)}
                />
            )}
        </div>
    );
};

export default RunRateDayExceptionsModal;
