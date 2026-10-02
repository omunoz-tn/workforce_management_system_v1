import React, { useState, useEffect, useMemo } from 'react';
import './Teams.css';
import './ReportSettings.css';
import './ScheduleBoard.css';
import './RunRateDayExceptionsModal.css';
import { MONTH_NAMES, WEEKDAY_HEADERS, todayStr, getCalendarCells } from './RunRateDayExceptionsModal';
import AbsenteeismEmployeeDayExceptionsModal from './AbsenteeismEmployeeDayExceptionsModal';

// The single "Exceptions" entry point for a team's Absenteeism Report. Two
// top-level tabs: "Days Exceptions" (calendar — excuses specific dates, either
// team-wide or for one employee only) and "Employees Exceptions" (excuses
// specific employees entirely, every day).
//
// Deliberately a separate modal from the Run Rate one rather than a shared,
// parameterised version: it writes to its own tables, so nothing configured
// here changes a Run Rate figure and nothing configured there changes an
// absence rate. There is no "Time Exceptions" tab — a partial shift has no
// meaning for a report that only asks whether someone showed up at all.
const AbsenteeismExceptionsModal = ({ team, onClose }) => {
    const [topTab, setTopTab] = useState('days'); // 'days' | 'employees'

    // --- Days Exceptions (calendar) ---
    const [excludedDates, setExcludedDates] = useState(new Set());
    const [anchorDate, setAnchorDate] = useState(new Date());
    const [loadingDays, setLoadingDays] = useState(true);
    const [daysSaveStatus, setDaysSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

    // 'team' = team-wide day exceptions; 'byEmployee' = pick one employee
    // (excluding anyone already fully excused via Employees Exceptions — they
    // don't need a per-day picker) to set day exceptions that apply ONLY to
    // that employee, not the rest of the team.
    const [dayScope, setDayScope] = useState('team');
    const [employeeDayModalFor, setEmployeeDayModalFor] = useState(null);

    // --- Employees Exceptions (whole-employee include/exclude) ---
    // The roster and the exclusions come from one call, and both tabs share
    // them: the Employee day-scope list is the roster minus whoever is already
    // excused outright.
    const [employees, setEmployees] = useState([]);
    const [excludedEmployeeIds, setExcludedEmployeeIds] = useState(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [loadingEmployees, setLoadingEmployees] = useState(true);
    const [excSaveStatus, setExcSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

    useEffect(() => {
        let cancelled = false;
        setLoadingDays(true);
        fetch(`./api/manage_absenteeism_excluded_days.php?team_id=${team.id}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (json.success) setExcludedDates(new Set(json.excluded_dates || []));
            })
            .catch(err => console.error('Failed to load absenteeism day exceptions', err))
            .finally(() => { if (!cancelled) setLoadingDays(false); });
        return () => { cancelled = true; };
    }, [team]);

    useEffect(() => {
        let cancelled = false;
        setLoadingEmployees(true);
        fetch(`./api/manage_absenteeism_exceptions.php?team_id=${team.id}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (!json.success) return;
                setEmployees(json.employees || []);
                setExcludedEmployeeIds(new Set((json.excluded_employee_ids || []).map(Number)));
            })
            .catch(err => console.error('Failed to load absenteeism employee exceptions', err))
            .finally(() => { if (!cancelled) setLoadingEmployees(false); });
        return () => { cancelled = true; };
    }, [team]);

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
            const res = await fetch('./api/manage_absenteeism_excluded_days.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ team_id: team.id, excluded_dates: [...excludedDates] })
            });
            const json = await res.json();
            setDaysSaveStatus(json.success ? 'saved' : 'error');
        } catch (err) {
            console.error('Failed to save absenteeism day exceptions', err);
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
    const excludeAllEmployees = () => { setExcludedEmployeeIds(new Set(employees.map(emp => emp.employee_id))); setExcSaveStatus(null); };

    const filteredEmployees = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return employees.filter(emp => emp.name.toLowerCase().includes(term));
    }, [employees, searchTerm]);

    // Whoever is excused outright already has every day excused, so a per-day
    // picker for them would be a no-op.
    const dayScopeEmployees = useMemo(
        () => employees.filter(emp => !excludedEmployeeIds.has(emp.employee_id)),
        [employees, excludedEmployeeIds]
    );

    const handleSaveEmployees = async () => {
        setExcSaveStatus('saving');
        try {
            const res = await fetch('./api/manage_absenteeism_exceptions.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employee_ids: employees.map(emp => emp.employee_id),
                    excluded_employee_ids: [...excludedEmployeeIds]
                })
            });
            const json = await res.json();
            setExcSaveStatus(json.success ? 'saved' : 'error');
        } catch (err) {
            console.error('Failed to save absenteeism employee exceptions', err);
            setExcSaveStatus('error');
        }
    };

    const cells = getCalendarCells(anchorDate);
    const weekCount = cells.length / 7;
    const includedEmployeeCount = employees.length - excludedEmployeeIds.size;

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
                                        Click a day to excuse it from this team's Absenteeism Report — e.g. a holiday
                                        or an office closure that shouldn't read as everyone failing to show up.
                                        Click again to count it.
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
                                                        title={excluded ? 'Click to count this day again' : 'Click to excuse this day'}
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
                                        Pick an employee to excuse specific days for them only — the rest of the team
                                        is unaffected. Employees already marked as an exception in "Employees Exceptions"
                                        don't need this and aren't listed here.
                                    </p>

                                    {loadingEmployees ? (
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
                                Only selected employees count toward this team's Absenteeism Report. Deselect an
                                employee to exclude them as an exception.
                            </p>
                            <input
                                type="text"
                                className="assignment-search"
                                placeholder="Search employees by name..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            {loadingEmployees ? (
                                <p className="text-muted">Loading employees...</p>
                            ) : employees.length === 0 ? (
                                <p className="text-muted">No employees found in this team.</p>
                            ) : (
                                <div className="employee-selection-list">
                                    {filteredEmployees.map(emp => (
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
                        <span style={{ marginRight: 'auto', fontSize: '0.9rem' }}>{includedEmployeeCount} of {employees.length} counted</span>
                        {excSaveStatus === 'saved' && <span className="advance-config-status success">Saved.</span>}
                        {excSaveStatus === 'error' && <span className="advance-config-status error">Failed to save. Try again.</span>}
                        <button onClick={onClose}>Cancel</button>
                        <button className="btn-primary" onClick={handleSaveEmployees} disabled={loadingEmployees || excSaveStatus === 'saving'}>
                            {excSaveStatus === 'saving' ? 'Saving...' : 'Save Exceptions'}
                        </button>
                    </div>
                )}
            </div>

            {employeeDayModalFor && (
                <AbsenteeismEmployeeDayExceptionsModal
                    employee={employeeDayModalFor}
                    team={team}
                    onClose={() => setEmployeeDayModalFor(null)}
                />
            )}
        </div>
    );
};

export default AbsenteeismExceptionsModal;
