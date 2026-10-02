import React, { useEffect, useMemo, useState } from 'react';
import { summarizeProjection, summarizeByTeam } from '../utils/runRateProjection';
import { todayStr, addDays } from '../utils/dates';

const pct = (value) => (value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`);
const shortDate = (dateStr) => new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const monthLabel = (ym) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const lastDayOf = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

/** The current month and the `count` before it, newest first, as Y-m. */
const recentMonths = (count) => {
    const [y, m] = todayStr().split('-').map(Number);
    return Array.from({ length: count + 1 }, (_, i) => {
        const d = new Date(y, m - 1 - i, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
};

const ErrorCell = ({ projected, real }) => {
    if (projected === null || projected === undefined || real === null || real === undefined) return <td>—</td>;
    const diff = projected - real;
    const abs = Math.abs(diff);
    const cls = abs <= 2 ? 'rr-proj-ok' : abs <= 5 ? 'rr-proj-warn' : 'rr-proj-bad';
    return <td className={cls}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)} pts</td>;
};

/**
 * Run Rate Report > Projection > Projection accuracy.
 *
 * Backtest: re-projects a past month as it would have looked on a chosen day, using only
 * the data that existed then, and holds it against what really happened.
 * Tuesday snapshots: what the projection actually said each Tuesday (stored by the weekly
 * cron) against the month's real Run Rate.
 */
const RunRateProjectionAccuracy = ({ onClose, getBand }) => {
    const [tab, setTab] = useState('backtest');
    const yesterday = addDays(todayStr(), -1);

    // ── Backtest ──
    const backtestMonths = recentMonths(6).filter(ym => `${ym}-01` <= yesterday);
    const [btMonth, setBtMonth] = useState(backtestMonths[1] || backtestMonths[0] || '');
    const [btAsOf, setBtAsOf] = useState(btMonth ? `${btMonth}-01` : '');
    const [btData, setBtData] = useState(null);
    const [btLoading, setBtLoading] = useState(false);
    const [btError, setBtError] = useState(null);

    const btTo = btMonth ? (lastDayOf(btMonth) < yesterday ? lastDayOf(btMonth) : yesterday) : '';

    useEffect(() => {
        if (tab !== 'backtest' || !btMonth || !btAsOf) return;
        let cancelled = false;
        setBtLoading(true);
        setBtError(null);
        fetch(`./api/get_run_rate_projection.php?from=${btMonth}-01&to=${btTo}&as_of=${btAsOf}&compare=1`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (json.success) setBtData(json);
                else setBtError(json.error || 'Failed to run the backtest.');
            })
            .catch(() => !cancelled && setBtError('Failed to run the backtest.'))
            .finally(() => !cancelled && setBtLoading(false));
        return () => { cancelled = true; };
    }, [tab, btMonth, btAsOf, btTo]);

    const btOverall = useMemo(() => btData ? summarizeProjection(btData.data, btData.team_dates, null, 100) : null, [btData]);
    const btTeams = useMemo(() => btData ? summarizeByTeam(btData.data, btData.team_dates, null, 100) : [], [btData]);
    const btMeanError = useMemo(() => {
        const errors = btTeams.filter(t => t.projectedPct !== null && t.realPct != null).map(t => Math.abs(t.projectedPct - t.realPct));
        return errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
    }, [btTeams]);

    // ── Tuesday snapshots ──
    const snapshotMonths = recentMonths(6);
    const [snMonth, setSnMonth] = useState(snapshotMonths[0]);
    const [snData, setSnData] = useState(null);
    const [snTeam, setSnTeam] = useState(null);
    const [snLoading, setSnLoading] = useState(false);
    const [snError, setSnError] = useState(null);

    useEffect(() => {
        if (tab !== 'snapshots') return;
        let cancelled = false;
        setSnLoading(true);
        setSnError(null);
        fetch(`./api/get_run_rate_projection_snapshots.php?month=${snMonth}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (json.success) setSnData(json);
                else setSnError(json.error || 'Failed to load snapshots.');
            })
            .catch(() => !cancelled && setSnError('Failed to load snapshots.'))
            .finally(() => !cancelled && setSnLoading(false));
        return () => { cancelled = true; };
    }, [tab, snMonth]);

    const snTeams = useMemo(() => {
        if (!snData) return [];
        return [...new Set(snData.snapshots.map(s => s.team_name))]
            .sort((a, b) => (a === snData.all_teams_key ? -1 : b === snData.all_teams_key ? 1 : a.localeCompare(b)));
    }, [snData]);
    const activeSnTeam = snTeam && snTeams.includes(snTeam) ? snTeam : snTeams[0];
    const snRows = snData ? snData.snapshots.filter(s => s.team_name === activeSnTeam) : [];
    const snReal = snData && activeSnTeam ? snData.real?.[activeSnTeam]?.pct ?? null : null;
    const teamLabel = (name) => (snData && name === snData.all_teams_key ? 'All teams' : name);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content rr-acc-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h2>Projection accuracy</h2>
                        <p className="rr-proj-muted" style={{ margin: 0 }}>How close the projection comes to what really happens.</p>
                    </div>
                    <button className="rr-acc-close" onClick={onClose} title="Close">&times;</button>
                </div>

                <div className="rr-acc-tabs">
                    <button className={tab === 'backtest' ? 'is-active' : ''} onClick={() => setTab('backtest')}>Backtest a past month</button>
                    <button className={tab === 'snapshots' ? 'is-active' : ''} onClick={() => setTab('snapshots')}>Tuesday snapshots</button>
                </div>

                <div className="modal-body rr-acc-body">
                    {tab === 'backtest' && (
                        <>
                            <div className="rr-acc-controls">
                                <label>
                                    Month
                                    <select value={btMonth} onChange={e => { setBtMonth(e.target.value); setBtAsOf(`${e.target.value}-01`); }}>
                                        {backtestMonths.map(ym => <option key={ym} value={ym}>{monthLabel(ym)}</option>)}
                                    </select>
                                </label>
                                <label>
                                    Projected as of
                                    <input type="date" min={`${btMonth}-01`} max={btTo} value={btAsOf} onChange={e => setBtAsOf(e.target.value)} />
                                </label>
                            </div>
                            <p className="rr-proj-muted rr-acc-note">
                                The month is projected with only the data that existed on {btAsOf ? shortDate(btAsOf) : '—'}, then compared
                                with the real Run Rate{btTo !== lastDayOf(btMonth) ? ` through ${shortDate(btTo)}` : ''}. Current team
                                assignments and settings are used, so a team reorganized since then may differ more.
                            </p>

                            {btLoading ? <div className="report-empty-state">Running backtest...</div>
                                : btError ? <div className="report-empty-state">⚠️ {btError}</div>
                                    : btData && (
                                        <table className="report-table rr-acc-table">
                                            <thead>
                                                <tr><th>Team</th><th>Projected</th><th>Real</th><th>Difference</th></tr>
                                            </thead>
                                            <tbody>
                                                {btOverall && (
                                                    <tr className="rr-acc-total">
                                                        <td>All teams</td>
                                                        <td>{pct(btOverall.projectedPct)}</td>
                                                        <td>{pct(btOverall.realPct)}</td>
                                                        <ErrorCell projected={btOverall.projectedPct} real={btOverall.realPct} />
                                                    </tr>
                                                )}
                                                {btTeams.map(t => (
                                                    <tr key={t.team}>
                                                        <td>{t.team}</td>
                                                        <td>{pct(t.projectedPct)}</td>
                                                        <td>{pct(t.realPct)}</td>
                                                        <ErrorCell projected={t.projectedPct} real={t.realPct} />
                                                    </tr>
                                                ))}
                                            </tbody>
                                            {btMeanError !== null && (
                                                <tfoot>
                                                    <tr><td colSpan="4">Average team error: <strong>{btMeanError.toFixed(1)} pts</strong></td></tr>
                                                </tfoot>
                                            )}
                                        </table>
                                    )}
                        </>
                    )}

                    {tab === 'snapshots' && (
                        <>
                            <div className="rr-acc-controls">
                                <label>
                                    Month
                                    <select value={snMonth} onChange={e => setSnMonth(e.target.value)}>
                                        {snapshotMonths.map(ym => <option key={ym} value={ym}>{monthLabel(ym)}</option>)}
                                    </select>
                                </label>
                                {snTeams.length > 0 && (
                                    <label>
                                        Team
                                        <select value={activeSnTeam} onChange={e => setSnTeam(e.target.value)}>
                                            {snTeams.map(t => <option key={t} value={t}>{teamLabel(t)}</option>)}
                                        </select>
                                    </label>
                                )}
                            </div>

                            {snLoading ? <div className="report-empty-state">Loading snapshots...</div>
                                : snError ? <div className="report-empty-state">⚠️ {snError}</div>
                                    : snData && snRows.length === 0 ? (
                                        <div className="report-empty-state">
                                            No Tuesday snapshots for {monthLabel(snMonth)} yet. One is taken every Tuesday morning.
                                        </div>
                                    ) : snData && (
                                        <>
                                            <p className="rr-proj-muted rr-acc-note">
                                                Real Run Rate: <strong>{pct(snReal)}</strong>
                                                {snData.month_closed ? ' (month closed)' : snData.real_through ? ` (to date, through ${shortDate(snData.real_through)})` : ''}
                                            </p>
                                            <table className="report-table rr-acc-table">
                                                <thead>
                                                    <tr><th>Tuesday</th><th>Projected</th><th>Difference vs real</th><th>High-confidence hours</th></tr>
                                                </thead>
                                                <tbody>
                                                    {snRows.map(s => (
                                                        <tr key={s.snapshot_date}>
                                                            <td>{shortDate(s.snapshot_date)}</td>
                                                            <td>
                                                                <div className="table-metric">
                                                                    <span>{pct(s.projected_pct)}</span>
                                                                    <div className="mini-progress rr-proj-bar">
                                                                        <div className="fill" style={{ width: '100%', background: getBand(Number(s.projected_pct || 0)).color }} />
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <ErrorCell projected={s.projected_pct === null ? null : Number(s.projected_pct)} real={snReal} />
                                                            <td>{s.high_confidence_share === null ? '—' : `${Math.round(Number(s.high_confidence_share))}%`}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </>
                                    )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RunRateProjectionAccuracy;
