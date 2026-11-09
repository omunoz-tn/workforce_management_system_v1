import React, { useState } from 'react';

// Expanded or collapsed, remembered per viewer; storage must never break the page.
const OPEN_STORAGE_KEY = 'rrProjectionRecOpen';
const readOpen = () => {
    try {
        return window.localStorage.getItem(OPEN_STORAGE_KEY) !== '0';
    } catch (_) {
        return true;
    }
};

const hours = (value) => `${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;
const pct = (value) => (value === null || value === undefined ? '—' : `${value.toFixed(1)}%`);

/**
 * Run Rate Report > Projection: what it would take to reach the goal, built by
 * buildRecommendations() (utils/runRateProjection.js). Projection only; the actual view
 * has nothing left to change.
 *
 * `historyWeeks` is how far back the weekday pattern looks (weekday_history_days / 7).
 */
const RunRateProjectionRecommendations = ({ rec, goal, historyWeeks }) => {
    const [open, setOpen] = useState(readOpen);
    const toggle = () => {
        const next = !open;
        setOpen(next);
        try { window.localStorage.setItem(OPEN_STORAGE_KEY, next ? '1' : '0'); } catch (_) { /* ignore */ }
    };

    if (!rec) return null;
    const { summary, status, employees, employeesCover, teams, weekday, review, reviewShown } = rec;

    const margin = summary.totalActual - (goal / 100) * summary.totalScheduled;

    const lead = status === 'on-track'
        ? <>Projected at <strong>{pct(summary.projectedPct)}</strong>, at or above the {goal}% goal with <strong>{hours(margin)}</strong> to spare. Keep the current pace.</>
        : status === 'behind'
            ? <>Projected at <strong>{pct(summary.projectedPct)}</strong>: <strong className="rr-proj-bad">{hours(summary.shortfall)} short</strong> of {goal}%. That is <strong>+{summary.extraPerDay.toFixed(1)} h/day</strong> across the {summary.remainingDays} working days left.</>
            : <>Projected at <strong>{pct(summary.projectedPct)}</strong>, {hours(summary.shortfall)} short of {goal}%, with no working days left to recover it.</>;

    const reviewNames = review.slice(0, reviewShown).map(r => r.name).join(', ');
    const reviewMore = review.length - Math.min(review.length, reviewShown);

    return (
        <div className={`rr-proj-rec${open ? '' : ' is-collapsed'}`}>
            <button type="button" className="rr-proj-rec-head" onClick={toggle} aria-expanded={open}>
                <span className="rr-proj-rec-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                <span className="rr-proj-rec-title">How to reach {goal}%</span>
                <span className={`rr-proj-rec-status is-${status}`}>
                    {status === 'on-track' ? 'On track' : status === 'behind' ? 'Below goal' : 'Out of time'}
                </span>
                {!open && status === 'behind' && (
                    <span className="rr-proj-rec-peek">
                        {pct(summary.projectedPct)} · +{summary.extraPerDay.toFixed(1)} h/day needed
                    </span>
                )}
            </button>
            {open && (
            <>
            <p className="rr-proj-rec-lead">{lead}</p>

            <div className="rr-proj-rec-grid">
                {employees.length > 0 && (
                    <section className="rr-proj-rec-item">
                        <h5>Employees with the largest gap</h5>
                        <ul>
                            {employees.map(e => (
                                <li key={`${e.employeeId}|${e.team}`}>
                                    <span className="rr-proj-rec-name">{e.name}</span>
                                    <span className="rr-proj-muted"> · {e.team}</span>
                                    <span className="rr-proj-rec-figure">
                                        {pct(e.projectedPct)} · {hours(e.gap)} short
                                        {e.perDay !== null && <> · <strong>+{e.perDay.toFixed(1)} h/day</strong></>}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {status === 'behind' && employeesCover !== null && (
                            <p className="rr-proj-rec-note">
                                Bringing these {employees.length} to {goal}% would cover {Math.round(employeesCover * 100)}% of the shortfall.
                            </p>
                        )}
                    </section>
                )}

                {teams.length > 0 && (
                    <section className="rr-proj-rec-item">
                        <h5>Teams below the goal</h5>
                        <ul>
                            {teams.map(t => (
                                <li key={t.team}>
                                    <span className="rr-proj-rec-name">{t.team}</span>
                                    <span className="rr-proj-rec-figure">
                                        {pct(t.projectedPct)} · {hours(t.shortfall)} short
                                        {t.extraPerDay !== null && t.extraPerDay > 0 && <> · <strong>+{t.extraPerDay.toFixed(1)} h/day</strong></>}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {weekday && (
                    <section className="rr-proj-rec-item">
                        <h5>Weakest weekday</h5>
                        {weekday.scope && (
                            <p>
                                <strong>{weekday.scope.name}</strong> ran at {pct(weekday.scope.pct)} over the last {historyWeeks} weeks,
                                against {pct(weekday.scope.restPct)} on the other days. Reinforce attendance and coverage on {weekday.scope.name}.
                            </p>
                        )}
                        {weekday.teams.length > 0 && (
                            <ul>
                                {weekday.teams.map(t => (
                                    <li key={t.team}>
                                        <span className="rr-proj-rec-name">{t.team}</span>
                                        <span className="rr-proj-rec-figure">
                                            {t.name}: {pct(t.pct)} vs {pct(t.restPct)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                )}

                {review.length > 0 && (
                    <section className="rr-proj-rec-item">
                        <h5>Check before trusting the number</h5>
                        <p>
                            {review.length} {review.length === 1 ? 'employee has' : 'employees have'} no worked day in the last 6 weeks
                            and {review.length === 1 ? 'is' : 'are'} projected at the team's rate: {reviewNames}
                            {reviewMore > 0 && <>, and {reviewMore} more</>}.
                        </p>
                        <p className="rr-proj-rec-note">
                            Enter a leave as excluded days; exclude from the Run Rate anyone who no longer works here or is a system account.
                        </p>
                    </section>
                )}
            </div>
            </>
            )}
        </div>
    );
};

export default RunRateProjectionRecommendations;
