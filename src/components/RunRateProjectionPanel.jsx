import React, { useMemo, useState } from 'react';
import './RunRateProjectionPanel.css';
import DailyDetailsModal from './DailyDetailsModal';
import RunRateProjectionAccuracy from './RunRateProjectionAccuracy';
import ViewToggle from './ViewToggle';
import SortDropdown from './SortDropdown';
import { summarizeProjection, summarizeByTeam, simulateProjection, defaultGoalFromRanges } from '../utils/runRateProjection';

const GOAL_STORAGE_KEY = 'rrProjectionGoal';

const hours = (value) => `${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
const pct = (value) => (value === null || value === undefined ? '—' : `${value.toFixed(1)}%`);
const shortDate = (dateStr) => dateStr
    ? new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

// Per-viewer preference, so browser storage is enough; it must never break the page.
const readGoal = () => {
    try {
        const stored = Number(window.localStorage.getItem(GOAL_STORAGE_KEY));
        return Number.isFinite(stored) && stored > 0 ? stored : null;
    } catch (_) {
        return null;
    }
};
const writeGoal = (value) => {
    try { window.localStorage.setItem(GOAL_STORAGE_KEY, String(value)); } catch (_) { /* ignore */ }
};

// Grid or list for the per-team breakdown, remembered per viewer like the goal.
const VIEW_STORAGE_KEY = 'rrProjectionView';
const readView = () => {
    try {
        return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
    } catch (_) {
        return 'grid';
    }
};

/**
 * Run Rate Report > Projection. Where the selected period is expected to close if nothing
 * changes, what it would take to reach the goal, and a what-if simulator on top.
 *
 * `projection` is the get_run_rate_projection.php payload; `selectedTeams` the report's
 * own team filter; `getBand` the report's colour-band resolver, so a projected 94% is
 * painted exactly like an actual 94%.
 */
const CONFIDENCE_RANK = { Low: 1, Medium: 2, High: 3 };

/**
 * Columns of the by-team breakdown. The same ids drive the list's sortable headers, the
 * grid's sort menu ('group_name' / 'display_metric' are the keys SortDropdown offers) and
 * the CSV, so the three can never order teams differently.
 */
const buildTeamColumns = (goal) => [
    { id: 'group_name', label: 'Team', type: 'string', defaultDirection: 'asc', accessor: t => t.team },
    { id: 'to_date', label: 'Run Rate to date', type: 'number', defaultDirection: 'desc', accessor: t => t.toDatePct },
    { id: 'display_metric', label: 'Projected Run Rate', type: 'number', defaultDirection: 'desc', accessor: t => t.projectedPct },
    { id: 'missed', label: 'Projected missed hours', type: 'number', defaultDirection: 'desc', accessor: t => t.projectedMissed },
    { id: 'extra', label: `Extra hours / day to reach ${goal}%`, type: 'number', defaultDirection: 'desc', accessor: t => t.extraPerDay },
    { id: 'confidence', label: 'Confidence', type: 'number', defaultDirection: 'desc', accessor: t => CONFIDENCE_RANK[t.confidence] ?? null }
];

const RunRateProjectionPanel = ({ projection, selectedTeams, colorRanges, getBand, fromDate, toDate, teamFilter }) => {
    const [goalOverride, setGoalOverride] = useState(readGoal);
    const goal = goalOverride ?? defaultGoalFromRanges(colorRanges);
    const [detailTeam, setDetailTeam] = useState(undefined); // undefined = closed, null = all selected
    const [showAccuracy, setShowAccuracy] = useState(false);
    const [showSimulator, setShowSimulator] = useState(false);
    const [viewMode, setViewModeState] = useState(readView);
    const [sortConfig, setSortConfig] = useState({ key: 'group_name', direction: 'asc' });
    const setViewMode = (mode) => {
        setViewModeState(mode);
        try { window.localStorage.setItem(VIEW_STORAGE_KEY, mode); } catch (_) { /* ignore */ }
    };
    const [sim, setSim] = useState({ scope: '__selected__', addPeople: 0, hoursPerDay: 8, peopleRatePct: '', overtimePerDay: 0, fromDate: projection?.projected_from || '' });

    const rows = projection?.data || [];
    const teamDates = projection?.team_dates || {};

    const overall = useMemo(
        () => summarizeProjection(rows, teamDates, selectedTeams, goal),
        [rows, teamDates, selectedTeams, goal]
    );
    const byTeam = useMemo(
        () => summarizeByTeam(rows, teamDates, selectedTeams, goal),
        [rows, teamDates, selectedTeams, goal]
    );

    const teamColumns = useMemo(() => buildTeamColumns(goal), [goal]);

    // Same ordering rules as the actual view: the chosen column, then team name. A value
    // that cannot be computed (no scheduled hours, no working days left) always sinks to
    // the bottom whichever way the column is sorted, rather than posing as a zero.
    const sortedTeams = useMemo(() => {
        const column = teamColumns.find(c => c.id === sortConfig.key) || teamColumns[0];
        const direction = sortConfig.direction === 'asc' ? 1 : -1;
        const byName = (a, b) => a.team.localeCompare(b.team, undefined, { numeric: true, sensitivity: 'base' });
        return [...byTeam].sort((a, b) => {
            const va = column.accessor(a);
            const vb = column.accessor(b);
            const missingA = va === null || va === undefined;
            const missingB = vb === null || vb === undefined;
            if (missingA || missingB) return missingA && missingB ? byName(a, b) : (missingA ? 1 : -1);
            const primary = column.type === 'string'
                ? String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' })
                : va - vb;
            return primary !== 0 ? primary * direction : byName(a, b);
        });
    }, [byTeam, sortConfig, teamColumns]);

    const handleSort = (column) => {
        setSortConfig(prev => prev.key === column.id
            ? { key: column.id, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
            : { key: column.id, direction: column.defaultDirection });
    };

    // Rows in the order on screen, with the hours behind each percentage so the file can
    // be re-totalled in a spreadsheet.
    const handleExportCSV = () => {
        if (!sortedTeams.length) return;
        const fixed = (value, digits) => (value === null || value === undefined ? '' : Number(value).toFixed(digits));
        const headers = [
            'Team', 'Run Rate to date (%)', 'Projected Run Rate (%)',
            'Actual Hours to date', 'Scheduled Hours to date',
            'Projected Actual Hours', 'Projected Scheduled Hours', 'Projected Missed Hours',
            `Extra Hours per Day to reach ${goal}%`, 'Working Days Left', 'Confidence',
            'Start Date', 'End Date', 'Projected From'
        ];
        const rowsOut = sortedTeams.map(t => [
            `"${t.team.replace(/"/g, '""')}"`,
            fixed(t.toDatePct, 1),
            fixed(t.projectedPct, 1),
            fixed(t.actualToDate, 2),
            fixed(t.scheduledToDate, 2),
            fixed(t.totalActual, 2),
            fixed(t.totalScheduled, 2),
            fixed(t.projectedMissed, 2),
            t.extraPerDay === null ? 'No working days left' : fixed(t.extraPerDay, 2),
            t.remainingDays,
            t.confidence || '',
            fromDate,
            toDate,
            projection.projected_from || ''
        ]);
        const csv = [headers.join(','), ...rowsOut.map(r => r.join(','))].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `Team_Breakdown_Run Rate Projection_${fromDate}_to_${toDate}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const simBase = sim.scope === '__selected__' ? overall : (byTeam.find(t => t.team === sim.scope) || overall);
    const simResult = useMemo(() => simulateProjection(simBase, sim), [simBase, sim]);

    const setGoal = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return;
        setGoalOverride(n);
        writeGoal(n);
    };

    const renderBar = (value, extraClassName = '') => {
        const { color, blinking } = getBand(value ?? 0);
        return (
            <div className={`mini-progress rr-proj-bar${extraClassName ? ` ${extraClassName}` : ''}`}>
                <div className={`fill${blinking ? ' fill-blinking' : ''}`} style={{ width: '100%', background: color }} />
            </div>
        );
    };

    const renderExtra = (summary) => {
        if (summary.extraPerDay === 0) return <span className="rr-proj-ok">On track</span>;
        if (summary.extraPerDay === null) return <span className="rr-proj-bad">No working days left</span>;
        return <span className="rr-proj-bad">+{summary.extraPerDay.toFixed(1)} h/day</span>;
    };

    const renderConfidence = (level) => level
        ? <span className={`rr-proj-confidence is-${level.toLowerCase()}`}>{level}</span>
        : <span className="rr-proj-muted">—</span>;

    if (!projection) return null;

    const noRows = byTeam.length === 0;

    return (
        <div className="rr-proj">
            <div className="rr-proj-head">
                <div>
                    <div className="rr-proj-title-row">
                        <h3>Projected Run Rate</h3>
                        <span className="rr-proj-tag">Projection</span>
                    </div>
                    <p className="rr-proj-sub">
                        {projection.actual_through
                            ? <>Actual hours through <strong>{shortDate(projection.actual_through)}</strong>, projected </>
                            : <>Projected </>}
                        from <strong>{shortDate(projection.projected_from)}</strong> to <strong>{shortDate(toDate)}</strong>,
                        using each employee's projected shift and their last 6 weeks of compliance.
                    </p>
                </div>
                <div className="rr-proj-head-actions">
                    <label className="rr-proj-goal" title="Target Run Rate used for the hours needed per day">
                        Goal
                        <input type="number" min="1" max="150" step="0.5" value={goal} onChange={e => setGoal(e.target.value)} />
                        %
                    </label>
                    <button type="button" className="rr-proj-btn secondary" onClick={() => setShowAccuracy(true)}>
                        Projection accuracy
                    </button>
                </div>
            </div>

            {noRows ? (
                <div className="report-empty-state">No teams to project for the current filters.</div>
            ) : (
                <>
                    <div className="rr-proj-cards">
                        <div className="rr-proj-card is-primary" onClick={() => setDetailTeam(null)} title="Click for the day-by-day breakdown">
                            <span className="rr-proj-card-label">Projected Run Rate</span>
                            <span className="rr-proj-card-value">{pct(overall.projectedPct)}</span>
                            {renderBar(overall.projectedPct)}
                            <span className="rr-proj-card-foot">{hours(overall.totalActual)} of {hours(overall.totalScheduled)}</span>
                        </div>
                        <div className="rr-proj-card">
                            <span className="rr-proj-card-label">Run Rate to date</span>
                            <span className="rr-proj-card-value">{pct(overall.toDatePct)}</span>
                            <span className="rr-proj-card-foot">
                                {projection.actual_through ? `${hours(overall.actualToDate)} of ${hours(overall.scheduledToDate)}` : 'Nothing worked yet in this range'}
                            </span>
                        </div>
                        <div className="rr-proj-card">
                            <span className="rr-proj-card-label">Projected missed hours</span>
                            <span className="rr-proj-card-value rr-proj-bad">{hours(overall.projectedMissed)}</span>
                            <span className="rr-proj-card-foot">{overall.remainingDays} working days left</span>
                        </div>
                        <div className="rr-proj-card">
                            <span className="rr-proj-card-label">Extra hours to reach {goal}%</span>
                            <span className="rr-proj-card-value">{renderExtra(overall)}</span>
                            <span className="rr-proj-card-foot">
                                {overall.shortfall > 0 ? `${hours(overall.shortfall)} short in total` : `Projected at or above ${goal}%`}
                            </span>
                        </div>
                        <div className="rr-proj-card">
                            <span className="rr-proj-card-label">Confidence</span>
                            <span className="rr-proj-card-value">{renderConfidence(overall.confidence)}</span>
                            <span className="rr-proj-card-foot">
                                {overall.highShare === null ? '—' : `${Math.round(overall.highShare * 100)}% of projected hours from employees with 15+ days of history`}
                            </span>
                        </div>
                    </div>

                    <div className="section-header-row rr-proj-teams-head">
                        <h4>By team</h4>
                        {/* Same controls, same order, as the actual view's Team Breakdown. */}
                        <div className="rr-proj-teams-actions">
                            <button
                                onClick={handleExportCSV}
                                className="export-btn secondary"
                                style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                            >
                                Export CSV
                            </button>
                            {teamFilter}
                            {viewMode === 'grid' && (
                                <SortDropdown
                                    sortConfig={sortConfig}
                                    onChange={setSortConfig}
                                    metricLabel="Projected Run Rate"
                                />
                            )}
                            <ViewToggle viewMode={viewMode} onChange={setViewMode} />
                        </div>
                    </div>

                    {viewMode === 'grid' ? (
                    <div className="team-cards-grid rr-proj-team-grid">
                        {sortedTeams.map(t => (
                            <div
                                key={t.team}
                                className="team-card clickable-row rr-proj-team-card"
                                onClick={() => setDetailTeam(t.team)}
                                title={`Day-by-day breakdown for ${t.team}`}
                            >
                                <div className="team-card-header">
                                    <span className="team-link-btn">{t.team}</span>
                                    <span className="team-card-metric-value">{pct(t.projectedPct)}</span>
                                </div>

                                {renderBar(t.projectedPct, 'team-card-progress')}

                                <div className="team-card-stats">
                                    <div className="team-card-stat">
                                        <span className="team-card-stat-label">Run Rate to date</span>
                                        <span className="team-card-stat-value">{pct(t.toDatePct)}</span>
                                    </div>
                                    <div className="team-card-stat">
                                        <span className="team-card-stat-label">Proj. hours</span>
                                        <span className="team-card-stat-value">{hours(t.totalActual)} / {hours(t.totalScheduled)}</span>
                                    </div>
                                    <div className="team-card-stat">
                                        <span className="team-card-stat-label">Projected missed</span>
                                        <span className="team-card-stat-value team-card-stat-missed">{hours(t.projectedMissed)}</span>
                                    </div>
                                    <div className="team-card-stat">
                                        <span className="team-card-stat-label">To reach {goal}%</span>
                                        <span className="team-card-stat-value">{renderExtra(t)}</span>
                                    </div>
                                    <div className="team-card-stat">
                                        <span className="team-card-stat-label">Confidence</span>
                                        <span className="team-card-stat-value">{renderConfidence(t.confidence)}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    ) : (
                    <div className="report-table-wrapper rr-proj-table-wrapper">
                        <table className="report-table rr-proj-table">
                            <thead>
                                <tr>
                                    {teamColumns.map(column => (
                                        <th
                                            key={column.id}
                                            className={`sortable-header ${sortConfig.key === column.id ? 'is-active' : ''}`}
                                            onClick={() => handleSort(column)}
                                            title={`Sort by ${column.label}`}
                                        >
                                            <span className="sortable-header-content">
                                                <span>{column.label}</span>
                                                <span className="sort-indicator">
                                                    {sortConfig.key === column.id ? (
                                                        <span
                                                            className={`sort-indicator-single sort-arrow ${sortConfig.direction === 'asc' ? 'sort-arrow-up' : 'sort-arrow-down'}`}
                                                            aria-hidden="true"
                                                        />
                                                    ) : (
                                                        <span className="sort-indicator-both" aria-hidden="true">
                                                            <span className="sort-arrow sort-arrow-up" />
                                                            <span className="sort-arrow sort-arrow-down" />
                                                        </span>
                                                    )}
                                                </span>
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sortedTeams.map(t => (
                                    <tr key={t.team} className="clickable-row" onClick={() => setDetailTeam(t.team)} title={`Day-by-day breakdown for ${t.team}`}>
                                        <td><span className="team-link-btn">{t.team}</span></td>
                                        <td>{pct(t.toDatePct)}</td>
                                        <td>
                                            <div className="table-metric">
                                                <span>{pct(t.projectedPct)}</span>
                                                {renderBar(t.projectedPct)}
                                            </div>
                                        </td>
                                        <td>{hours(t.projectedMissed)}</td>
                                        <td>{renderExtra(t)}</td>
                                        <td>{renderConfidence(t.confidence)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    )}

                    <div className="rr-proj-sim">
                        <button type="button" className="rr-proj-sim-toggle" onClick={() => setShowSimulator(v => !v)}>
                            {showSimulator ? '▾' : '▸'} What-if simulator
                            <span className="rr-proj-muted"> — try a change before making it; nothing is saved</span>
                        </button>

                        {showSimulator && (
                            <div className="rr-proj-sim-body">
                                <div className="rr-proj-sim-inputs">
                                    <label>
                                        Scope
                                        <select value={sim.scope} onChange={e => setSim({ ...sim, scope: e.target.value })}>
                                            <option value="__selected__">All selected teams</option>
                                            {byTeam.map(t => <option key={t.team} value={t.team}>{t.team}</option>)}
                                        </select>
                                    </label>
                                    <label>
                                        People to add (negative to remove)
                                        <input type="number" step="1" value={sim.addPeople} onChange={e => setSim({ ...sim, addPeople: e.target.value })} />
                                    </label>
                                    <label>
                                        Scheduled hours each / day
                                        <input type="number" min="0" max="24" step="0.5" value={sim.hoursPerDay} onChange={e => setSim({ ...sim, hoursPerDay: e.target.value })} />
                                    </label>
                                    <label>
                                        Their compliance %
                                        <input
                                            type="number"
                                            min="0"
                                            max="150"
                                            step="1"
                                            placeholder={(simBase.projectedRate * 100).toFixed(0)}
                                            value={sim.peopleRatePct}
                                            onChange={e => setSim({ ...sim, peopleRatePct: e.target.value })}
                                        />
                                    </label>
                                    <label>
                                        Overtime hours / day (whole scope)
                                        <input type="number" min="0" step="0.5" value={sim.overtimePerDay} onChange={e => setSim({ ...sim, overtimePerDay: e.target.value })} />
                                    </label>
                                    <label>
                                        Starting
                                        <input
                                            type="date"
                                            min={projection.projected_from || undefined}
                                            max={toDate}
                                            value={sim.fromDate}
                                            onChange={e => setSim({ ...sim, fromDate: e.target.value })}
                                        />
                                    </label>
                                </div>
                                <div className="rr-proj-sim-result">
                                    <div>
                                        <span className="rr-proj-card-label">Simulated Run Rate</span>
                                        <span className="rr-proj-card-value">{pct(simResult.projectedPct)}</span>
                                        {renderBar(simResult.projectedPct)}
                                    </div>
                                    <div>
                                        <span className="rr-proj-card-label">Change</span>
                                        <span className={`rr-proj-card-value ${simResult.deltaPct > 0 ? 'rr-proj-ok' : simResult.deltaPct < 0 ? 'rr-proj-bad' : ''}`}>
                                            {simResult.deltaPct === null ? '—' : `${simResult.deltaPct >= 0 ? '+' : ''}${simResult.deltaPct.toFixed(1)} pts`}
                                        </span>
                                        <span className="rr-proj-card-foot">vs {pct(simBase.projectedPct)} projected</span>
                                    </div>
                                    <div>
                                        <span className="rr-proj-card-label">Missed hours</span>
                                        <span className="rr-proj-card-value">{hours(simResult.projectedMissed)}</span>
                                        <span className="rr-proj-card-foot">over {simResult.days} working days from {shortDate(sim.fromDate)}</span>
                                    </div>
                                </div>
                                <p className="rr-proj-muted rr-proj-sim-note">
                                    Added people run at the compliance you enter, or at the scope's projected
                                    {' '}{(simBase.projectedRate * 100).toFixed(0)}% when left blank — at that rate they add hours
                                    but leave the percentage where it is. Overtime counts as worked hours on top of the schedule.
                                </p>
                            </div>
                        )}
                    </div>
                </>
            )}

            {detailTeam !== undefined && (
                <DailyDetailsModal
                    isOpen
                    onClose={() => setDetailTeam(undefined)}
                    fromDate={fromDate}
                    toDate={toDate}
                    team={detailTeam || undefined}
                    withProjection
                />
            )}

            {showAccuracy && (
                <RunRateProjectionAccuracy
                    onClose={() => setShowAccuracy(false)}
                    getBand={getBand}
                />
            )}
        </div>
    );
};

export default RunRateProjectionPanel;
