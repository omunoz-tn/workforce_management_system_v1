import React, { useState, useEffect, useMemo, useRef } from 'react';
import './ScheduleBoard.css';
import './ShiftManagement.css';
import ShiftCard, { shiftHours, formatTime, toInputTime, fromInputTime } from './ShiftCard';
import WeekPicker from './WeekPicker';
import { todayStr, addDays, formatDate, mondayOf } from '../utils/dates';

const WEEKDAYS = [
    { iso: 1, label: 'Monday', short: 'Mon' },
    { iso: 2, label: 'Tuesday', short: 'Tue' },
    { iso: 3, label: 'Wednesday', short: 'Wed' },
    { iso: 4, label: 'Thursday', short: 'Thu' },
    { iso: 5, label: 'Friday', short: 'Fri' },
    { iso: 6, label: 'Saturday', short: 'Sat' },
    { iso: 7, label: 'Sunday', short: 'Sun' }
];

const OFF = 'OFF';
const formatDateLabel = (dateStr) =>
    dateStr ? new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

/** '09:00:00|18:00:00' <-> the {start,end} shape ShiftCard renders. */
const signatureToShift = (signature) =>
    (!signature || signature === OFF)
        ? { start: '00:00:00', end: '00:00:00' }
        : { start: signature.split('|')[0], end: signature.split('|')[1] };

const shiftToSignature = (shift) =>
    (!shift || shift.start === '00:00:00') ? OFF : `${shift.start}|${shift.end}`;

/**
 * The week the editor falls back to when the source week has nothing on it — a new hire,
 * or a week from before the employee was ever synced. The active template first, then the
 * employee's usual shift on weekdays, so the seven cards never open blank.
 */
const seedPatternFrom = (detail) => {
    const seeded = {};
    if (detail?.current_version?.pattern) {
        WEEKDAYS.forEach(d => { seeded[d.iso] = detail.current_version.pattern[d.iso] || OFF; });
        return seeded;
    }
    const typical = detail?.typical_shift;
    WEEKDAYS.forEach(d => {
        seeded[d.iso] = (typical && d.iso <= 5) ? `${typical.start}|${typical.end}` : OFF;
    });
    return seeded;
};

/**
 * One board row's seven dates mapped onto ISO weekdays. A day the board has no entry for is
 * not the same as a day off — that is a week with no data — so a row that turns out to be
 * entirely empty hands back null and the caller seeds instead.
 */
const patternFromWeek = (row, weekDates) => {
    const pattern = {};
    let hasData = false;
    WEEKDAYS.forEach((d, idx) => {
        const schedule = row?.schedules?.[weekDates[idx]];
        if (!schedule) {
            pattern[d.iso] = OFF;
            return;
        }
        hasData = true;
        pattern[d.iso] = shiftToSignature(schedule);
    });
    return hasData ? pattern : null;
};

const ShiftManagement = ({ initialEmployee = null }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [roster, setRoster] = useState([]);
    const [rosterLoading, setRosterLoading] = useState(true);
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const [employee, setEmployee] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [error, setError] = useState(null);

    // weekday(1-7) -> signature. The single source of truth for the editor.
    const [pattern, setPattern] = useState({});
    const [editingDay, setEditingDay] = useState(null);
    const [duplicateFrom, setDuplicateFrom] = useState(null);
    const [duplicateTargets, setDuplicateTargets] = useState([]);

    // The week the seven cards were loaded from. This is the source, not the target: the
    // Effective Period below decides where the edited week lands. Always a noon-anchored
    // Monday, which is what WeekPicker hands back.
    const [sourceWeek, setSourceWeek] = useState(() => mondayOf());
    const [weekLoading, setWeekLoading] = useState(false);
    // Set by every edit, cleared on every load, so switching weeks can warn before it
    // throws away hand-entered shifts.
    const [patternDirty, setPatternDirty] = useState(false);

    const [effectiveStart, setEffectiveStart] = useState(addDays(todayStr(), 1));
    const [effectiveEnd, setEffectiveEnd] = useState('');

    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [applying, setApplying] = useState(false);
    const [toast, setToast] = useState(null);

    const searchRef = useRef(null);

    // The roster comes from the Schedule Board endpoint, so this page searches exactly the
    // people the board shows rather than a separate employee list. `roster=1` asks that
    // endpoint for the names only: the search needs id, name and team, and the full board
    // response made it wait on the whole forecast engine to get them.
    useEffect(() => {
        fetch('./api/get_schedule_board.php?roster=1')
            .then(res => res.json())
            .then(json => {
                if (json.success) setRoster(json.data || []);
                else setError(json.error || 'Failed to load employees.');
            })
            .catch(() => setError('Failed to load employees.'))
            .finally(() => setRosterLoading(false));
    }, []);

    useEffect(() => {
        const onClickAway = (e) => {
            if (searchRef.current && !searchRef.current.contains(e.target)) setDropdownOpen(false);
        };
        document.addEventListener('mousedown', onClickAway);
        return () => document.removeEventListener('mousedown', onClickAway);
    }, []);

    const matches = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return [];
        return roster
            .filter(emp =>
                (emp.name || '').toLowerCase().includes(term) ||
                String(emp.id).includes(term) ||
                (emp.team || '').toLowerCase().includes(term)
            )
            .slice(0, 12);
    }, [roster, searchTerm]);

    const selectEmployee = async (emp) => {
        setEmployee(emp);
        setDropdownOpen(false);
        setSearchTerm('');
        setDetailLoading(true);
        setError(null);
        setPreview(null);
        setEditingDay(null);
        setSourceWeek(mondayOf()); // a newly picked employee always opens on this week
        try {
            const res = await fetch(`./api/manage_shift_schedule.php?employee_id=${emp.id}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to load schedule.');
            setDetail(json);

            // Only the effective period is seeded here; the seven cards come from the
            // source week, loaded by the effect below.
            if (json.current_version?.pattern) {
                setEffectiveStart(json.current_version.effective_start);
                setEffectiveEnd(json.current_version.effective_end);
            } else {
                setEffectiveStart(addDays(todayStr(), 1));
                setEffectiveEnd('');
            }
        } catch (err) {
            setError(err.message || 'Failed to load schedule.');
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    };


    // Arriving from a Schedule Board row: that row already carries the id and name
    // selectEmployee needs, so the editor opens on the employee without waiting for the
    // roster fetch or making the user type the name again.
    useEffect(() => {
        if (initialEmployee) selectEmployee(initialEmployee);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialEmployee]);

    const sourceWeekStart = formatDate(sourceWeek);
    const sourceWeekDates = useMemo(
        () => Array.from({ length: 7 }, (_, i) => addDays(sourceWeekStart, i)),
        [sourceWeekStart]
    );

    // Fills the seven cards from the source week, read off the same endpoint Schedule Board
    // uses — so the editor opens on exactly what that screen shows for the week: an applied
    // template where one covers it, the real synced shifts otherwise.
    useEffect(() => {
        if (!employee || !detail) return undefined;
        let cancelled = false;
        setWeekLoading(true);
        fetch(`./api/get_schedule_board.php?from=${sourceWeekDates[0]}&to=${sourceWeekDates[6]}&employee_id=${employee.id}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (!json.success) throw new Error(json.error || 'Failed to load that week.');
                const row = (json.data || []).find(e => e.id === employee.id);
                setPattern(patternFromWeek(row, sourceWeekDates) || seedPatternFrom(detail));
                setError(null); // clears a failure left over from a previously picked week
                setPatternDirty(false);
                setEditingDay(null);
                setPreview(null);
            })
            .catch(() => {
                if (cancelled) return;
                // Something to edit beats an empty grid, so fall back rather than blanking.
                setPattern(seedPatternFrom(detail));
                setPatternDirty(false);
                setError("Could not load that week's schedule — showing the current template instead.");
            })
            .finally(() => { if (!cancelled) setWeekLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [employee?.id, detail, sourceWeekStart]);

    // Loading another week replaces every card, so unsaved edits get a chance to survive.
    const changeSourceWeek = (monday) => {
        if (patternDirty && !window.confirm(
            'Loading another week replaces the shifts you edited here. Continue?'
        )) {
            return;
        }
        setSourceWeek(monday);
    };

    const lunchHours = (detail?.employee?.lunch_time || 0) / 60;

    const setDay = (iso, signature) => {
        setPattern(prev => ({ ...prev, [iso]: signature }));
        setPatternDirty(true);
        setPreview(null); // any edit invalidates a preview taken before it
    };

    const weeklyHours = useMemo(
        () => WEEKDAYS.reduce((sum, d) => sum + shiftHours(signatureToShift(pattern[d.iso]), lunchHours), 0),
        [pattern, lunchHours]
    );

    const confirmDuplicate = () => {
        const source = pattern[duplicateFrom];
        const overwriting = duplicateTargets.filter(iso => pattern[iso] && pattern[iso] !== OFF);
        if (overwriting.length > 0) {
            const names = overwriting.map(iso => WEEKDAYS.find(d => d.iso === iso).label).join(', ');
            if (!window.confirm(`${names} already ${overwriting.length === 1 ? 'has a shift' : 'have shifts'}. Overwrite ${overwriting.length === 1 ? 'it' : 'them'}?`)) {
                return;
            }
        }
        setPattern(prev => {
            const next = { ...prev };
            duplicateTargets.forEach(iso => { next[iso] = source; });
            return next;
        });
        setPatternDirty(true);
        setPreview(null);
        setDuplicateFrom(null);
        setDuplicateTargets([]);
    };

    const validationError = useMemo(() => {
        if (!employee) return 'Select an employee first.';
        if (!effectiveEnd) return 'Apply Until is required.';
        if (effectiveEnd < effectiveStart) return 'Apply Until cannot be earlier than Effective Start.';
        for (const d of WEEKDAYS) {
            const sig = pattern[d.iso];
            if (!sig || sig === OFF) continue;
            const [start, end] = sig.split('|');
            if (start === '00:00:00' || end === '00:00:00') return `${d.label} is missing a time.`;
            if (end <= start) return `${d.label} ends at or before it starts.`;
        }
        return null;
    }, [employee, effectiveStart, effectiveEnd, pattern]);

    const buildPayload = (action) => ({
        action,
        employee_id: employee.id,
        employee_name: employee.name,
        effective_start: effectiveStart,
        effective_end: effectiveEnd,
        pattern
    });

    const runPreview = async () => {
        if (validationError) return;
        setPreviewing(true);
        setError(null);
        try {
            const res = await fetch('./api/manage_shift_schedule.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildPayload('preview'))
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Preview failed.');
            setPreview(json.preview);
        } catch (err) {
            setError(err.message || 'Preview failed.');
        } finally {
            setPreviewing(false);
        }
    };

    const applySchedule = async () => {
        setApplying(true);
        setError(null);
        try {
            const res = await fetch('./api/manage_shift_schedule.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildPayload('apply'))
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not apply the schedule.');
            const applied = json.applied;
            setToast(`Schedule applied — ${applied.shifts} shift${applied.shifts === 1 ? '' : 's'} and ${applied.off_days} off day${applied.off_days === 1 ? '' : 's'} updated through ${formatDateLabel(effectiveEnd)}.`);
            setConfirmOpen(false);
            setPreview(null);
            selectEmployee(employee); // reload so the new version shows in the history
        } catch (err) {
            setError(err.message || 'Could not apply the schedule.');
            setConfirmOpen(false);
        } finally {
            setApplying(false);
        }
    };

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), 6000);
        return () => clearTimeout(timer);
    }, [toast]);

    const resetAll = () => {
        setEmployee(null);
        setDetail(null);
        setPattern({});
        setPreview(null);
        setError(null);
        setEditingDay(null);
    };

    return (
        <div className="schedule-board-container shift-mgmt-container">
            <header className="board-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1>Shift Management</h1>
                    </div>
                    <div className="week-range-label">Search, edit, and apply recurring employee schedules.</div>
                </div>
            </header>

            <div className="board-main-area shift-mgmt-main">
                {/* ── Employee search ── */}
                <div className="shift-mgmt-search" ref={searchRef}>
                    <div className="search-box">
                        <span className="search-icon">🔍</span>
                        <input
                            type="text"
                            placeholder="Search by name, employee ID, or team..."
                            value={searchTerm}
                            onChange={(e) => { setSearchTerm(e.target.value); setDropdownOpen(true); }}
                            onFocus={() => setDropdownOpen(true)}
                            disabled={rosterLoading}
                        />
                    </div>
                    {dropdownOpen && searchTerm.trim() && (
                        <div className="shift-mgmt-dropdown">
                            {matches.length === 0 ? (
                                <div className="shift-mgmt-dropdown-empty">No employees match "{searchTerm}"</div>
                            ) : matches.map(emp => (
                                <button key={emp.id} type="button" className="shift-mgmt-dropdown-item" onClick={() => selectEmployee(emp)}>
                                    <span className="shift-mgmt-dd-name">{emp.name}</span>
                                    <span className="shift-mgmt-dd-meta">#{emp.id} · {emp.team || 'Unassigned'}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {error && <div className="shift-mgmt-error">⚠️ {error}</div>}

                {!employee ? (
                    <div className="shift-mgmt-placeholder">
                        {rosterLoading ? 'Loading employees...' : 'Search for an employee to view and edit their weekly schedule.'}
                    </div>
                ) : detailLoading ? (
                    <div className="shift-mgmt-placeholder">Loading schedule...</div>
                ) : detail && (
                    <>
                        {/* ── Selected employee summary ── */}
                        <div className="shift-mgmt-summary">
                            <div className="shift-mgmt-summary-main">
                                <span className="shift-mgmt-emp-name">{detail.employee.name}</span>
                                <span className="shift-mgmt-emp-meta">
                                    ID {detail.employee.employee_id} · {detail.employee.team || 'Unassigned'}
                                    {detail.employee.campaign && ` · ${detail.employee.campaign}`}
                                </span>
                                <span className="shift-mgmt-emp-template">
                                    {detail.current_version
                                        ? `Current template: ${formatDateLabel(detail.current_version.effective_start)} → ${formatDateLabel(detail.current_version.effective_end)}`
                                        : detail.typical_shift
                                            ? `No template yet — seeded from the usual ${formatTime(detail.typical_shift.start)}–${formatTime(detail.typical_shift.end)} shift`
                                            : 'No template and no shift history yet'}
                                </span>
                            </div>
                            <button type="button" className="shift-mgmt-clear" onClick={resetAll}>Change employee</button>
                        </div>

                        {/* ── Weekly editor ──
                            The weekly total sits here rather than in the page header so it
                            stays in view next to the cards while days are being adjusted.
                            The week picker beside it names the source of the seven cards —
                            the week the schedule being edited was taken from — and is the
                            same control as the Schedule Board's, so moving between weeks
                            reads identically on both screens. */}
                        <div className="shift-mgmt-week-header">
                            <span className="shift-mgmt-week-title">Weekly Schedule</span>
                            <span className="badge">{weeklyHours.toFixed(2)} h / week</span>
                            <WeekPicker monday={sourceWeek} onChange={changeSourceWeek} align="left" />
                            <span className="shift-mgmt-week-source">
                                {weekLoading ? 'Loading week...' : 'Source week'}
                            </span>
                        </div>

                        <div className="shift-mgmt-week">
                            {WEEKDAYS.map(day => {
                                const signature = pattern[day.iso] || OFF;
                                const shift = signatureToShift(signature);
                                const isOff = signature === OFF;
                                const isEditing = editingDay === day.iso;
                                return (
                                    <div key={day.iso} className={`shift-mgmt-day ${isEditing ? 'is-editing' : ''}`}>
                                        <div className="shift-mgmt-day-header">
                                            <span className="day-name">{day.short}</span>
                                            <span className="shift-mgmt-day-hours">{shiftHours(shift, lunchHours).toFixed(2)}h</span>
                                        </div>

                                        <div className="shift-mgmt-card-slot">
                                            <ShiftCard
                                                schedule={isOff ? null : shift}
                                                lunchHours={lunchHours}
                                                editing={isEditing && !isOff}
                                                onChange={(next) => setDay(day.iso, shiftToSignature(next))}
                                            />
                                        </div>

                                        <div className="shift-mgmt-day-actions">
                                            <label className="shift-mgmt-off-toggle" title="Mark this day as an Off Day">
                                                <input
                                                    type="checkbox"
                                                    checked={isOff}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setDay(day.iso, OFF);
                                                            setEditingDay(null);
                                                        } else {
                                                            const seed = detail.typical_shift
                                                                ? `${detail.typical_shift.start}|${detail.typical_shift.end}`
                                                                : '09:00:00|18:00:00';
                                                            setDay(day.iso, seed);
                                                            setEditingDay(day.iso);
                                                        }
                                                    }}
                                                />
                                                Off Day
                                            </label>
                                            <div className="shift-mgmt-day-buttons">
                                                <button
                                                    type="button"
                                                    className="shift-mgmt-icon-btn"
                                                    disabled={isOff}
                                                    onClick={() => setEditingDay(isEditing ? null : day.iso)}
                                                    title={isOff ? 'Turn off the Off Day toggle first' : (isEditing ? 'Done editing' : 'Edit this shift')}
                                                >
                                                    {isEditing ? 'Done' : 'Edit'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="shift-mgmt-icon-btn"
                                                    disabled={isOff}
                                                    onClick={() => { setDuplicateFrom(day.iso); setDuplicateTargets([]); }}
                                                    title={isOff ? 'Nothing to duplicate from an Off Day' : 'Copy this shift to other days'}
                                                >
                                                    Duplicate
                                                </button>
                                                <button
                                                    type="button"
                                                    className="shift-mgmt-icon-btn is-danger"
                                                    disabled={isOff}
                                                    onClick={() => {
                                                        if (window.confirm(`Delete ${day.label}'s shift? The day becomes an Off Day.`)) {
                                                            setDay(day.iso, OFF);
                                                            setEditingDay(null);
                                                        }
                                                    }}
                                                    title={isOff ? 'Already an Off Day' : 'Delete this shift'}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* ── Effective period ── */}
                        <div className="shift-mgmt-period">
                            <h2>Schedule Effective Period</h2>
                            <div className="shift-mgmt-period-fields">
                                <label>
                                    {/* The caption is one element on purpose: the label is a
                                        column flexbox, so a bare text node plus a sibling
                                        asterisk would stack as two rows and push this input
                                        a line below the other one. */}
                                    <span className="shift-mgmt-field-label">Effective Start</span>
                                    <input
                                        type="date"
                                        value={effectiveStart}
                                        onChange={(e) => { setEffectiveStart(e.target.value); setPreview(null); }}
                                    />
                                </label>
                                <label>
                                    <span className="shift-mgmt-field-label">
                                        Apply Until <span className="shift-mgmt-required">*</span>
                                    </span>
                                    <input
                                        type="date"
                                        value={effectiveEnd}
                                        min={effectiveStart}
                                        onChange={(e) => { setEffectiveEnd(e.target.value); setPreview(null); }}
                                    />
                                </label>
                            </div>
                            <p className="shift-mgmt-note">
                                Effective Start can be in the past. On days already recorded, this schedule replaces the
                                shift DeskTime reported — which also changes the Scheduled Hours those days contribute to
                                the Run Rate. The hours actually tracked are never modified.
                            </p>
                        </div>

                        {/* ── Preview ── */}
                        {preview && (
                            <div className="shift-mgmt-preview">
                                <h2>Schedule Changes</h2>
                                <p className="shift-mgmt-preview-range">
                                    Effective: {formatDateLabel(effectiveStart)} → {formatDateLabel(effectiveEnd)}
                                </p>
                                <ul>
                                    <li><strong>{preview.days}</strong> calendar days affected</li>
                                    <li><strong>{preview.shifts}</strong> shifts created</li>
                                    <li>
                                        <strong>{preview.replaced}</strong> existing scheduled days replaced
                                        {preview.replaced > 0 && (
                                            <span className="shift-mgmt-preview-muted">
                                                {' '}({preview.replaced_schedule} from a previous schedule,{' '}
                                                {preview.replaced_forecast} from a forecast)
                                            </span>
                                        )}
                                    </li>
                                    <li><strong>{preview.off_days}</strong> off days</li>
                                    {preview.skipped_past > 0 && (
                                        <li className="shift-mgmt-preview-muted">
                                            <strong>{preview.skipped_past}</strong> past days skipped (no recorded day to change)
                                            {preview.first_applied && ` — changes start ${formatDateLabel(preview.first_applied)}`}
                                        </li>
                                    )}
                                    {preview.first_applied && preview.first_applied <= detail.today && (
                                        <li className="shift-mgmt-preview-retro">
                                            This period reaches into days already recorded, so Run Rate figures already
                                            reported for them will change.
                                        </li>
                                    )}
                                    {preview.forecast_override_removed && (
                                        <li>The manual forecast from Configuration → Scheduling → Forecast will be removed, since this period covers all of it.</li>
                                    )}
                                    {preview.forecast_override_present && !preview.forecast_override_removed && (
                                        <li className="shift-mgmt-preview-muted">
                                            A manual forecast exists outside this period and stays in place for the dates this schedule does not cover.
                                        </li>
                                    )}
                                </ul>
                            </div>
                        )}

                        {/* ── Version history ── */}
                        {detail.versions.length > 0 && (
                            <div className="shift-mgmt-versions">
                                <h2>Schedule History</h2>
                                {detail.versions.map(v => (
                                    <div key={v.id} className="shift-mgmt-version">
                                        <span>{formatDateLabel(v.effective_start)} → {formatDateLabel(v.effective_end)}</span>
                                        <span className="shift-mgmt-version-days">
                                            {WEEKDAYS.filter(d => (v.pattern[d.iso] || OFF) !== OFF).map(d => d.short).join(' ') || 'All off'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* ── Actions ── */}
                        <div className="shift-mgmt-actions">
                            {validationError && <span className="shift-mgmt-validation">{validationError}</span>}
                            <button type="button" onClick={resetAll}>Cancel</button>
                            <button type="button" onClick={runPreview} disabled={!!validationError || previewing}>
                                {previewing ? 'Checking...' : 'Preview Changes'}
                            </button>
                            <button
                                type="button"
                                className="btn-primary"
                                onClick={() => setConfirmOpen(true)}
                                disabled={!!validationError || applying}
                            >
                                Apply Schedule
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* ── Duplicate day picker ── */}
            {duplicateFrom && (
                <div className="modal-overlay" onClick={() => setDuplicateFrom(null)}>
                    <div className="modal-content shift-mgmt-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Duplicate {WEEKDAYS.find(d => d.iso === duplicateFrom)?.label}</h2>
                            <button className="icon-btn" onClick={() => setDuplicateFrom(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p className="shift-mgmt-note">
                                Copy {formatTime(signatureToShift(pattern[duplicateFrom]).start)}–
                                {formatTime(signatureToShift(pattern[duplicateFrom]).end)} to:
                            </p>
                            {WEEKDAYS.filter(d => d.iso !== duplicateFrom).map(d => {
                                const willOverwrite = pattern[d.iso] && pattern[d.iso] !== OFF;
                                return (
                                    <label key={d.iso} className="shift-mgmt-dup-day">
                                        <input
                                            type="checkbox"
                                            checked={duplicateTargets.includes(d.iso)}
                                            onChange={(e) => setDuplicateTargets(prev =>
                                                e.target.checked ? [...prev, d.iso] : prev.filter(x => x !== d.iso)
                                            )}
                                        />
                                        {d.label}
                                        {willOverwrite && <span className="shift-mgmt-dup-warn">has a shift</span>}
                                    </label>
                                );
                            })}
                        </div>
                        <div className="modal-footer">
                            <button type="button" onClick={() => setDuplicateFrom(null)}>Cancel</button>
                            <button type="button" className="btn-primary" disabled={duplicateTargets.length === 0} onClick={confirmDuplicate}>
                                Duplicate to {duplicateTargets.length} day{duplicateTargets.length === 1 ? '' : 's'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Apply confirmation ── */}
            {confirmOpen && (
                <div className="modal-overlay" onClick={() => setConfirmOpen(false)}>
                    <div className="modal-content shift-mgmt-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Apply this schedule?</h2>
                            <button className="icon-btn" onClick={() => setConfirmOpen(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p>
                                From <strong>{formatDateLabel(effectiveStart)}</strong> through{' '}
                                <strong>{formatDateLabel(effectiveEnd)}</strong>, any schedule or forecast already
                                governing {detail?.employee?.name} in that period will be replaced by this weekly
                                pattern.
                            </p>
                            {detail?.forecast_override && (
                                <p className="shift-mgmt-confirm-warn">
                                    This employee has a manual forecast set in Configuration → Scheduling → Forecast.
                                    It is superseded inside this period, and removed entirely if the period covers all
                                    of it.
                                </p>
                            )}
                            {effectiveStart <= (detail?.today || todayStr()) && (
                                <p className="shift-mgmt-confirm-warn">
                                    This period starts in the past. On days already recorded, the Scheduled Hours behind
                                    the Run Rate will be recalculated, so figures previously reported for those days will
                                    change. Tracked hours stay exactly as DeskTime reported them.
                                </p>
                            )}
                            <p className="shift-mgmt-note">
                                Dates outside the period stay as they are, and the previous schedule is kept in the
                                history.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button type="button" onClick={() => setConfirmOpen(false)}>Cancel</button>
                            <button type="button" className="btn-primary" onClick={applySchedule} disabled={applying}>
                                {applying ? 'Applying...' : 'Replace and apply'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && <div className="shift-mgmt-toast">✅ {toast}</div>}
        </div>
    );
};

export default ShiftManagement;
