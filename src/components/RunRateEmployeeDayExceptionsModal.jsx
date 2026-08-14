import React, { useState, useEffect } from 'react';
import './Teams.css';
import './ReportSettings.css';
import './ScheduleBoard.css';
import './RunRateDayExceptionsModal.css';
import { MONTH_NAMES, WEEKDAY_HEADERS, todayStr, getCalendarCells } from './RunRateDayExceptionsModal';

// Same calendar as the team-wide "Days Exceptions", but scoped to a single
// employee — marking a day here only excludes it for this employee, leaving
// the rest of their team's Run Rate untouched.
const RunRateEmployeeDayExceptionsModal = ({ employee, team, onClose }) => {
    const [excludedDates, setExcludedDates] = useState(new Set());
    const [anchorDate, setAnchorDate] = useState(new Date());
    const [loading, setLoading] = useState(true);
    const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch(`./api/manage_run_rate_excluded_employee_days.php?employee_id=${employee.employee_id}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (json.success) setExcludedDates(new Set(json.excluded_dates || []));
            })
            .catch(err => console.error('Failed to load employee run rate day exceptions', err))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [employee]);

    const toggleDate = (dateStr) => {
        setExcludedDates(prev => {
            const next = new Set(prev);
            if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
            return next;
        });
        setSaveStatus(null);
    };

    const navigateMonth = (direction) => {
        const d = new Date(anchorDate);
        d.setMonth(d.getMonth() + direction);
        setAnchorDate(d);
    };

    const handleSave = async () => {
        setSaveStatus('saving');
        try {
            const res = await fetch('./api/manage_run_rate_excluded_employee_days.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employee_id: employee.employee_id, excluded_dates: [...excludedDates] })
            });
            const json = await res.json();
            setSaveStatus(json.success ? 'saved' : 'error');
        } catch (err) {
            console.error('Failed to save employee run rate day exceptions', err);
            setSaveStatus('error');
        }
    };

    const cells = getCalendarCells(anchorDate);
    const weekCount = cells.length / 7;

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '680px', maxHeight: '92vh' }}>
                <div className="modal-header">
                    <div>
                        <h2>Days Exceptions</h2>
                        <p className="text-muted" style={{ margin: 0 }}>Team: {team.name}</p>
                        <p className="text-muted" style={{ margin: 0 }}>Employee: {employee.name}</p>
                    </div>
                    <button className="icon-btn" onClick={onClose} title="Close">✕</button>
                </div>

                <div className="modal-body">
                    <p className="text-muted" style={{ marginTop: 0 }}>
                        Click a day to exclude it from this employee's Run Rate only — their team and
                        teammates are unaffected. Click again to include it.
                    </p>

                    <div className="day-exceptions-nav navigation-controls">
                        <button type="button" className="nav-btn prev" onClick={() => navigateMonth(-1)}>←</button>
                        <button type="button" className="nav-btn today" onClick={() => setAnchorDate(new Date())}>Today</button>
                        <button type="button" className="nav-btn next" onClick={() => navigateMonth(1)}>→</button>
                        <span className="day-exceptions-month-label">
                            {MONTH_NAMES[anchorDate.getMonth()]} {anchorDate.getFullYear()}
                        </span>
                    </div>

                    {loading ? (
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
                </div>

                <div className="modal-footer">
                    <span style={{ marginRight: 'auto', fontSize: '0.9rem' }}>{excludedDates.size} day(s) excluded</span>
                    {saveStatus === 'saved' && <span className="advance-config-status success">Saved.</span>}
                    {saveStatus === 'error' && <span className="advance-config-status error">Failed to save. Try again.</span>}
                    <button onClick={onClose}>Cancel</button>
                    <button className="btn-primary" onClick={handleSave} disabled={loading || saveStatus === 'saving'}>
                        {saveStatus === 'saving' ? 'Saving...' : 'Save Exceptions'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RunRateEmployeeDayExceptionsModal;
