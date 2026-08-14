import React, { useState, useEffect, useMemo } from 'react';
import './Teams.css';
import './ReportSettings.css';
import './ScheduleBoard.css';
import './RunRateDayExceptionsModal.css';
import RunRateEmployeeDayExceptionsModal from './RunRateEmployeeDayExceptionsModal';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAY_HEADERS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export const todayStr = new Date().toISOString().split('T')[0];

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

// The single "Exceptions" entry point for a team's Run Rate. Two top-level
// tabs: "Days Exceptions" (calendar — excludes specific dates, team-wide or
// for one employee only) and "Employees Exceptions" (excludes specific
// employees entirely, every day). Both write to independent tables, so they
// never conflict with each other.
const RunRateDayExceptionsModal = ({ team, onClose }) => {
    const [topTab, setTopTab] = useState('days'); // 'days' | 'employees'

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
        fetch('./api/get_dashboard_stats.php')
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                const teamRows = (json.mtdEmployeeData || []).filter(row => row.team_name === team.name && !Number(row.is_excluded));
                setDayScopeEmployees(teamRows.map(row => ({ employee_id: row.employee_id, name: row.name })));
            })
            .catch(err => console.error('Failed to load team employees', err))
            .finally(() => { if (!cancelled) setLoadingDayScopeEmployees(false); });
        return () => { cancelled = true; };
    }, [dayScope, team]);

    useEffect(() => {
        if (topTab !== 'employees' || excEmployeesLoaded) return;
        let cancelled = false;
        setLoadingExcEmployees(true);
        fetch('./api/get_dashboard_stats.php')
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                const teamRows = (json.mtdEmployeeData || []).filter(row => row.team_name === team.name);
                setExcEmployees(teamRows.map(row => ({ employee_id: row.employee_id, name: row.name })));
                setExcludedEmployeeIds(new Set(teamRows.filter(row => Number(row.is_excluded)).map(row => row.employee_id)));
                setExcEmployeesLoaded(true);
            })
            .catch(err => console.error('Failed to load run rate exceptions', err))
            .finally(() => { if (!cancelled) setLoadingExcEmployees(false); });
        return () => { cancelled = true; };
    }, [topTab, team, excEmployeesLoaded]);

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
                    </div>

                    {topTab === 'days' ? (
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
                    ) : (
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
