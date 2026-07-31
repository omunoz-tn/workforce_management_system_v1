import React, { useState, useEffect, useMemo } from 'react';
import './ScheduleBoard.css';
import './ScheduleForecastSettings.css';

const getMonday = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
};

const getWeekDates = (monday) => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split('T')[0];
});

const formatTime = (t) => {
    if (!t || t === '00:00:00') return '-';
    const [h, m] = t.split(':');
    const hh = parseInt(h);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const displayHour = hh % 12 || 12;
    return `${displayHour}:${m} ${ampm}`;
};

const timeToSeconds = (t) => {
    if (!t || t === '00:00:00') return 0;
    const parts = t.split(':').map(Number);
    return (parts[0] * 3600) + (parts[1] * 60) + (parts[2] || 0);
};

// HTML time inputs use "HH:MM"; schedules are stored/transmitted as "HH:MM:SS".
const toTimeInputValue = (t) => (t ? t.slice(0, 5) : '');
const fromTimeInputValue = (v) => (v ? `${v}:00` : '');

const formatWeekLabel = (weekDates) => {
    const start = new Date(weekDates[0] + 'T12:00:00');
    const end = new Date(weekDates[6] + 'T12:00:00');
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
};

// ISO 8601 week number (Monday-based, week 1 = week containing the year's first Thursday).
const getISOWeekNumber = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

const formatWeekLabelWithNumber = (weekDates) => {
    const start = new Date(weekDates[0] + 'T12:00:00');
    const end = new Date(weekDates[6] + 'T12:00:00');
    const weekNum = getISOWeekNumber(start);
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} (${weekNum})`;
};

const todayMonday = getMonday(new Date()).toISOString().split('T')[0];

// Every remaining week of the current calendar year, starting from this week, as
// selectable cards for the "Apply Through Week" step.
const buildRemainingWeeksOfYear = () => {
    const weeks = [];
    const currentYear = new Date().getFullYear();
    let monday = getMonday(new Date());
    while (monday.getFullYear() === currentYear) {
        const weekDates = getWeekDates(monday);
        weeks.push({ weekStart: weekDates[0], label: formatWeekLabelWithNumber(weekDates) });
        monday = new Date(monday.getTime());
        monday.setDate(monday.getDate() + 7);
    }
    return weeks;
};

const remainingWeeksOfYear = buildRemainingWeeksOfYear();

const ScheduleForecastSettings = ({ activeTab, onTabChange }) => {
    const [employees, setEmployees] = useState([]);
    const [employeeSearch, setEmployeeSearch] = useState('');
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [overrides, setOverrides] = useState([]);
    const [loadingOverrides, setLoadingOverrides] = useState(true);

    const [sourceAnchor, setSourceAnchor] = useState(new Date());
    const [targetAnchor, setTargetAnchor] = useState(new Date());
    const [sourceSchedules, setSourceSchedules] = useState({});
    const [loadingPreview, setLoadingPreview] = useState(false);

    // Manual corrections to the source week, keyed by date ("YYYY-MM-DD"). Lets an
    // admin fill in days with no synced data (or mark a day OFF) before saving —
    // these take priority over sourceSchedules and become the saved pattern.
    const [manualEdits, setManualEdits] = useState({});
    const [editingDate, setEditingDate] = useState(null);
    const [editDraft, setEditDraft] = useState({ start: '', end: '' });
    const [editError, setEditError] = useState(null);

    // Copy a day's schedule onto one or more other days of the same source week.
    const [copySourceDate, setCopySourceDate] = useState(null);
    const [copyTargets, setCopyTargets] = useState([]);

    const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
    const [saveError, setSaveError] = useState(null);

    const sourceWeekDates = useMemo(() => getWeekDates(getMonday(sourceAnchor)), [sourceAnchor]);
    const targetWeekDates = useMemo(() => getWeekDates(getMonday(targetAnchor)), [targetAnchor]);
    const sourceWeekStart = sourceWeekDates[0];
    const targetEndWeekStart = targetWeekDates[0];

    const loadOverrides = async () => {
        setLoadingOverrides(true);
        try {
            const res = await fetch('./api/manage_schedule_forecast.php');
            const json = await res.json();
            if (json.success) setOverrides(json.overrides || []);
        } catch (err) {
            console.error('Failed to load forecast overrides', err);
        } finally {
            setLoadingOverrides(false);
        }
    };

    useEffect(() => {
        fetch('./api/get_online_employees.php?status=all')
            .then(res => res.json())
            .then(json => { if (json.success) setEmployees(json.data || []); })
            .catch(err => console.error('Failed to load employees', err));

        loadOverrides();
    }, []);

    useEffect(() => {
        if (!selectedEmployee) return;
        setLoadingPreview(true);
        fetch(`./api/get_schedule_board.php?from=${sourceWeekDates[0]}&to=${sourceWeekDates[6]}`)
            .then(res => res.json())
            .then(json => {
                if (json.success) {
                    const match = (json.data || []).find(e => e.id === selectedEmployee.employee_id);
                    setSourceSchedules(match ? match.schedules : {});
                }
            })
            .catch(err => console.error('Failed to load source week preview', err))
            .finally(() => setLoadingPreview(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEmployee, sourceWeekStart]);

    const filteredEmployees = useMemo(() => {
        const term = employeeSearch.toLowerCase();
        return employees.filter(emp =>
            emp.name.toLowerCase().includes(term) ||
            (emp.group_name && emp.group_name.toLowerCase().includes(term))
        );
    }, [employees, employeeSearch]);

    const existingOverride = selectedEmployee
        ? overrides.find(o => o.employee_id === selectedEmployee.employee_id)
        : null;

    // A manual edit for a date takes priority over whatever was actually synced.
    const getEffectiveSchedule = (date) => (
        Object.prototype.hasOwnProperty.call(manualEdits, date) ? manualEdits[date] : sourceSchedules[date]
    );

    // Total hours for the source week (manual edits included).
    const sourceWeekTotalHours = useMemo(() => {
        const lunchHours = selectedEmployee?.lunch_deduction_hours || 0;
        return sourceWeekDates.reduce((total, date) => {
            const sched = getEffectiveSchedule(date);
            if (!sched || !sched.start || sched.start === '00:00:00') return total;
            const dayHours = (timeToSeconds(sched.end) - timeToSeconds(sched.start)) / 3600 - lunchHours;
            return total + Math.max(dayHours, 0);
        }, 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceSchedules, manualEdits, sourceWeekDates, selectedEmployee]);

    // Builds the {weekday(1-7): "HH:MM:SS|HH:MM:SS" | "OFF"} pattern that gets saved.
    const buildPattern = () => {
        const pattern = {};
        sourceWeekDates.forEach((date, idx) => {
            const sched = getEffectiveSchedule(date);
            pattern[idx + 1] = (!sched || !sched.start || sched.start === '00:00:00')
                ? 'OFF'
                : `${sched.start}|${sched.end}`;
        });
        return pattern;
    };

    const handleSelectEmployee = (emp) => {
        setSelectedEmployee(emp);
        setSaveStatus(null);
        setSaveError(null);
        setEditingDate(null);
        const existing = overrides.find(o => o.employee_id === emp.employee_id);
        if (existing) {
            const anchor = new Date(existing.source_week_start + 'T12:00:00');
            setSourceAnchor(anchor);
            setTargetAnchor(new Date(existing.target_end_week_start + 'T12:00:00'));

            // Re-seed manual edits from the saved pattern, mapped back onto that
            // week's actual calendar dates so they show up on the right day cells.
            if (existing.pattern) {
                const weekDates = getWeekDates(getMonday(anchor));
                const seeded = {};
                weekDates.forEach((d, idx) => {
                    const signature = existing.pattern[idx + 1];
                    if (!signature) return;
                    seeded[d] = signature === 'OFF'
                        ? { start: '00:00:00', end: '00:00:00' }
                        : { start: signature.split('|')[0], end: signature.split('|')[1] };
                });
                setManualEdits(seeded);
            } else {
                setManualEdits({});
            }
        } else {
            setSourceAnchor(new Date());
            setTargetAnchor(new Date());
            setManualEdits({});
        }
    };

    const navigateSourceWeek = (weeks) => {
        const d = new Date(sourceAnchor);
        d.setDate(d.getDate() + weeks * 7);
        setSourceAnchor(d);
        setEditingDate(null);
        setCopySourceDate(null);
        setCopyTargets([]);
    };

    const startEditingDay = (date) => {
        const effective = getEffectiveSchedule(date);
        const isOff = !effective || !effective.start || effective.start === '00:00:00';
        setEditDraft({
            start: isOff ? '' : toTimeInputValue(effective.start),
            end: isOff ? '' : toTimeInputValue(effective.end)
        });
        setEditError(null);
        setEditingDate(date);
        setCopySourceDate(null);
        setCopyTargets([]);
    };

    const cancelEditingDay = () => {
        setEditingDate(null);
        setEditError(null);
    };

    const saveEditedDay = () => {
        if (!editDraft.start || !editDraft.end) {
            setEditError('Start and End are required.');
            return;
        }
        const start = fromTimeInputValue(editDraft.start);
        const end = fromTimeInputValue(editDraft.end);
        if (end <= start) {
            setEditError('End must be after start.');
            return;
        }
        setManualEdits(prev => ({ ...prev, [editingDate]: { start, end } }));
        setEditingDate(null);
    };

    const markDayOff = () => {
        setManualEdits(prev => ({ ...prev, [editingDate]: { start: '00:00:00', end: '00:00:00' } }));
        setEditingDate(null);
    };

    const revertDayEdit = (date) => {
        setManualEdits(prev => {
            const next = { ...prev };
            delete next[date];
            return next;
        });
    };

    const startCopyingDay = (date) => {
        setEditingDate(null);
        setCopySourceDate(date);
        setCopyTargets([]);
    };

    const toggleCopyTarget = (date) => {
        setCopyTargets(prev => (prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]));
    };

    const cancelCopyingDay = () => {
        setCopySourceDate(null);
        setCopyTargets([]);
    };

    const applyCopyToTargets = () => {
        const source = getEffectiveSchedule(copySourceDate);
        const sourceValue = (!source || !source.start || source.start === '00:00:00')
            ? { start: '00:00:00', end: '00:00:00' }
            : { start: source.start, end: source.end };

        setManualEdits(prev => {
            const next = { ...prev };
            copyTargets.forEach(date => { next[date] = sourceValue; });
            return next;
        });
        setCopySourceDate(null);
        setCopyTargets([]);
    };

    const validationError = sourceWeekStart > todayMonday
        ? 'The source week cannot be in the future.'
        : (targetEndWeekStart < todayMonday
            ? 'The apply-through week cannot be entirely in the past.'
            : null);

    const handleSave = async () => {
        if (!selectedEmployee || validationError) return;
        setSaveStatus('saving');
        setSaveError(null);
        try {
            const res = await fetch('./api/manage_schedule_forecast.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employee_id: selectedEmployee.employee_id,
                    employee_name: selectedEmployee.name,
                    source_week_start: sourceWeekStart,
                    target_end_week_start: targetEndWeekStart,
                    pattern: buildPattern()
                })
            });
            const json = await res.json();
            if (json.success) {
                setSaveStatus('saved');
                loadOverrides();
            } else {
                setSaveStatus('error');
                setSaveError(json.error || 'Failed to save.');
            }
        } catch (err) {
            console.error('Failed to save forecast override', err);
            setSaveStatus('error');
            setSaveError('Failed to save.');
        }
    };

    const handleRemove = async (override) => {
        if (!window.confirm(`Remove the forecast override for ${override.employee_name}? Their future schedule will go back to the automatic prediction.`)) {
            return;
        }
        try {
            const res = await fetch(`./api/manage_schedule_forecast.php?employee_id=${override.employee_id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.success) {
                loadOverrides();
            }
        } catch (err) {
            console.error('Failed to remove forecast override', err);
        }
    };

    const dayShortName = (date) => new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });

    const renderPreviewDay = (date) => {
        const dayName = dayShortName(date);
        const isEdited = Object.prototype.hasOwnProperty.call(manualEdits, date);

        if (editingDate === date) {
            return (
                <div key={date} className="forecast-preview-day forecast-preview-day-editing">
                    <span className="forecast-preview-day-name">{dayName}</span>
                    <div className="forecast-day-editor">
                        <input
                            type="time"
                            className="forecast-day-time-input"
                            value={editDraft.start}
                            onChange={(e) => setEditDraft(d => ({ ...d, start: e.target.value }))}
                        />
                        <input
                            type="time"
                            className="forecast-day-time-input"
                            value={editDraft.end}
                            onChange={(e) => setEditDraft(d => ({ ...d, end: e.target.value }))}
                        />
                        {editError && <span className="forecast-day-edit-error">{editError}</span>}
                        <div className="forecast-day-editor-actions">
                            <button type="button" className="forecast-day-save-btn" onClick={saveEditedDay}>Save</button>
                            <button type="button" className="forecast-day-off-btn" onClick={markDayOff}>OFF</button>
                            <button type="button" className="forecast-day-cancel-btn" onClick={cancelEditingDay}>Cancel</button>
                        </div>
                    </div>
                </div>
            );
        }

        const schedule = getEffectiveSchedule(date);
        const isOff = !schedule || !schedule.start || schedule.start === '00:00:00';

        return (
            <div
                key={date}
                className={`forecast-preview-day forecast-preview-day-editable ${isEdited ? 'forecast-preview-day-edited' : ''}`}
                onClick={() => startEditingDay(date)}
                title="Click to edit"
            >
                <span className="forecast-preview-day-name">{dayName}</span>
                {isOff ? (
                    <span className="shift-off">OFF</span>
                ) : (
                    <div className="shift-card forecast-preview-card" title={`${formatTime(schedule.start)} - ${formatTime(schedule.end)}`}>
                        <div className="shift-row">
                            <span className="shift-time">{formatTime(schedule.start)}</span>
                        </div>
                        <div className="shift-row">
                            <span className="shift-time">{formatTime(schedule.end)}</span>
                        </div>
                    </div>
                )}
                <div className="forecast-day-actions">
                    <button
                        type="button"
                        className="forecast-day-copy-btn"
                        title="Copy to other days"
                        onClick={(e) => { e.stopPropagation(); startCopyingDay(date); }}
                    >
                        ⧉
                    </button>
                    {isEdited && (
                        <button
                            type="button"
                            className="forecast-day-revert-btn"
                            title="Revert to synced data"
                            onClick={(e) => { e.stopPropagation(); revertDayEdit(date); }}
                        >
                            ↺
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="schedule-board-container">
            <header className="board-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1>Scheduling</h1>
                        <span className="badge">Forecast Source</span>
                    </div>
                    <div className="week-range-label">
                        Pin a specific past week as the forecast source for an employee's future schedule.
                    </div>
                </div>
                <div className="settings-tab-toggle navigation-controls">
                    <button
                        type="button"
                        className={`nav-btn ${activeTab === 'forecast' ? 'today' : ''}`}
                        onClick={() => onTabChange('forecast')}
                    >
                        Forecast Source
                    </button>
                    <button
                        type="button"
                        className={`nav-btn ${activeTab === 'holidays' ? 'today' : ''}`}
                        onClick={() => onTabChange('holidays')}
                    >
                        Holiday
                    </button>
                </div>
            </header>

            <div className="forecast-settings-scroll">
                <section className="forecast-settings-section">
                    <h2>1. Select Employee</h2>
                    <input
                        type="text"
                        className="forecast-employee-search"
                        placeholder="Search name or team..."
                        value={employeeSearch}
                        onChange={(e) => setEmployeeSearch(e.target.value)}
                    />
                    <div className="forecast-employee-grid">
                        {filteredEmployees.map(emp => (
                            <div
                                key={emp.employee_id}
                                className={`forecast-employee-item ${selectedEmployee?.employee_id === emp.employee_id ? 'selected' : ''}`}
                                onClick={() => handleSelectEmployee(emp)}
                            >
                                {emp.name}
                                {emp.group_name && <span className="forecast-employee-team"> · {emp.group_name}</span>}
                            </div>
                        ))}
                    </div>
                </section>

                {selectedEmployee && (
                    <>
                        {existingOverride && (
                            <p className="forecast-override-note">
                                Replacing existing override for <strong>{existingOverride.employee_name}</strong>: week of {existingOverride.source_week_start} through week of {existingOverride.target_end_week_start}.
                            </p>
                        )}

                        <section className="forecast-settings-section">
                            <h2>2. Source Week</h2>
                            <p className="section-desc">Choose the week whose actual schedule should be copied forward. Click a day to fill in a missing shift or mark it OFF.</p>
                            <div className="forecast-week-nav">
                                <button className="nav-btn prev" onClick={() => navigateSourceWeek(-1)}>←</button>
                                <span className="forecast-week-label">{formatWeekLabel(sourceWeekDates)}</span>
                                <button className="nav-btn next" onClick={() => navigateSourceWeek(1)} disabled={sourceWeekStart >= todayMonday}>→</button>
                            </div>
                            {!loadingPreview && (
                                <div className="forecast-week-total">Total: {sourceWeekTotalHours.toFixed(2)} hrs</div>
                            )}
                            <div className="forecast-week-preview">
                                {loadingPreview ? (
                                    <span className="forecast-preview-loading">Loading...</span>
                                ) : (
                                    sourceWeekDates.map(renderPreviewDay)
                                )}
                            </div>

                            {copySourceDate && (
                                <div className="forecast-copy-panel">
                                    <span className="forecast-copy-label">
                                        Copy {dayShortName(copySourceDate)}'s schedule to:
                                    </span>
                                    <div className="forecast-copy-days">
                                        {sourceWeekDates.filter(d => d !== copySourceDate).map(d => (
                                            <label key={d} className="forecast-copy-day-checkbox">
                                                <input
                                                    type="checkbox"
                                                    checked={copyTargets.includes(d)}
                                                    onChange={() => toggleCopyTarget(d)}
                                                />
                                                {dayShortName(d)}
                                            </label>
                                        ))}
                                    </div>
                                    <div className="forecast-copy-actions">
                                        <button
                                            type="button"
                                            className="forecast-day-save-btn"
                                            disabled={copyTargets.length === 0}
                                            onClick={applyCopyToTargets}
                                        >
                                            Copy
                                        </button>
                                        <button type="button" className="forecast-day-cancel-btn" onClick={cancelCopyingDay}>Cancel</button>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section className="forecast-settings-section">
                            <h2>3. Apply Through Week</h2>
                            <p className="section-desc">Future weeks from now through the selected week will use the source week's pattern, one day of the week matched to the same day of the week.</p>
                            <div className="forecast-week-card-grid">
                                {remainingWeeksOfYear.map(week => (
                                    <div
                                        key={week.weekStart}
                                        className={`forecast-week-card ${week.weekStart === targetEndWeekStart ? 'selected' : ''}`}
                                        onClick={() => setTargetAnchor(new Date(week.weekStart + 'T12:00:00'))}
                                    >
                                        {week.label}
                                    </div>
                                ))}
                            </div>
                        </section>

                        {validationError && <p className="forecast-error">{validationError}</p>}

                        <div className="forecast-save-bar">
                            <button
                                className="forecast-save-btn"
                                onClick={handleSave}
                                disabled={!!validationError || saveStatus === 'saving'}
                            >
                                {saveStatus === 'saving' ? 'Saving...' : 'Save Override'}
                            </button>
                            {saveStatus === 'saved' && <span className="forecast-status success">Saved.</span>}
                            {saveStatus === 'error' && <span className="forecast-status error">{saveError}</span>}
                        </div>
                    </>
                )}

                <section className="forecast-settings-section">
                    <h2>Active Overrides</h2>
                    {loadingOverrides ? (
                        <p className="section-desc">Loading...</p>
                    ) : overrides.length === 0 ? (
                        <p className="section-desc">No active forecast overrides.</p>
                    ) : (
                        <table className="forecast-overrides-table">
                            <thead>
                                <tr>
                                    <th>Employee</th>
                                    <th>Source Week</th>
                                    <th>Applies Through</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {overrides.map(o => (
                                    <tr key={o.id}>
                                        <td>{o.employee_name}</td>
                                        <td>{o.source_week_start}</td>
                                        <td>{o.target_end_week_start}</td>
                                        <td>
                                            <button className="forecast-remove-btn" onClick={() => handleRemove(o)}>Remove</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>
            </div>
        </div>
    );
};

export default ScheduleForecastSettings;
