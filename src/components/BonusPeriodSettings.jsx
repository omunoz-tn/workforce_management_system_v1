import React, { useEffect, useState } from 'react';
import BonusReopenModal from './BonusReopenModal';
import './BonusApprovalEmailSettings.css';

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Configuration > HR > Bonus Period Management.
 *
 * Reopening lives here rather than on the Bonus list itself, and deliberately so: the list
 * is where a month is worked on, and the button that undoes a sign-off should not sit next
 * to the cells it unlocks. Getting here is a short, separate walk, which is the right amount
 * of friction for an action that reverses something Finance has already been told about.
 *
 * The month picker defaults to LAST month — the one HR > Bonus opens on, and the one most
 * likely to have just been approved. The Re-open button is offered only for a period that is
 * actually approved; every other state says so instead of offering a button that would fail.
 */
const BonusPeriodSettings = () => {
    const today = new Date();
    // Day 0 of this month is the last day of the previous one, so this lands on last month
    // in January too.
    const lastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

    const [year, setYear] = useState(lastMonth.getFullYear());
    const [month, setMonth] = useState(lastMonth.getMonth() + 1);
    const [state, setState] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [reopenOpen, setReopenOpen] = useState(false);

    const periodLabel = `${MONTHS[month - 1]} ${year}`;

    useEffect(() => {
        let cancelled = false;

        // In a function rather than the effect body: the state this sets belongs to the
        // fetch, not to the render that scheduled it.
        const read = async () => {
            setLoading(true);
            setNotice(null);
            try {
                const res = await fetch(`./api/manage_bonus_approval.php?year=${year}&month=${month}`);
                const json = await res.json();
                if (cancelled) return;
                if (!json.success) throw new Error(json.error || 'Could not read the period.');
                setState(json.approval);
                setError(null);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        read();
        return () => { cancelled = true; };
    }, [year, month]);

    const handleReopen = async (reason) => {
        const res = await fetch('./api/manage_bonus_approval.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'reopen', year, month, reason })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Could not reopen the period.');

        setState(json.approval);
        setReopenOpen(false);
        setNotice(`${periodLabel} is open again. The bonus list can be edited.`);
    };

    const yearOptions = [];
    for (let option = today.getFullYear() + 1; option >= today.getFullYear() - 4; option--) {
        yearOptions.push(option);
    }

    const formatMoment = (value) => (value ? new Date(value.replace(' ', 'T')).toLocaleString() : '—');

    return (
        <section className="forecast-settings-section">
            <h2>Bonus Period Management</h2>
            <p className="section-desc">
                An approved bonus period is locked: amounts, days and currency cannot be edited, and it
                cannot be approved a second time. Reopening one unlocks it again and requires a written
                reason.
            </p>

            {error && <div className="bonus-email-banner is-error">{error}</div>}
            {notice && <div className="bonus-email-banner is-ok">{notice}</div>}

            <div className="bonus-period-picker">
                <select
                    className="company-input bonus-period-select"
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    aria-label="Bonus month"
                >
                    {MONTHS.map((name, index) => (
                        <option key={name} value={index + 1}>{name}</option>
                    ))}
                </select>
                <select
                    className="company-input bonus-period-select"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    aria-label="Bonus year"
                >
                    {yearOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
            </div>

            {loading && <p className="bonus-email-empty">Reading {periodLabel}…</p>}

            {!loading && state && (
                <div className={`bonus-period-state is-${state.status}`}>
                    {state.status === 'approved' && (
                        <>
                            <div className="bonus-period-state-head">✓ Approved and locked</div>
                            <dl className="bonus-period-facts">
                                <div><dt>Approved by</dt><dd>{state.approved_by || '—'}</dd></div>
                                <div><dt>Approved on</dt><dd>{formatMoment(state.approved_at)}</dd></div>
                                <div><dt>Employees</dt><dd>{state.approved_employees ?? '—'}</dd></div>
                            </dl>
                            <button className="company-add-btn" onClick={() => setReopenOpen(true)}>
                                Re-open Bonus
                            </button>
                        </>
                    )}

                    {state.status === 'reopened' && (
                        <>
                            <div className="bonus-period-state-head">Re-opened — editable</div>
                            <dl className="bonus-period-facts">
                                <div><dt>Approved by</dt><dd>{state.approved_by || '—'}</dd></div>
                                <div><dt>Re-opened by</dt><dd>{state.reopened_by || '—'}</dd></div>
                                <div><dt>Re-opened on</dt><dd>{formatMoment(state.reopened_at)}</dd></div>
                            </dl>
                            {state.reopen_reason && (
                                <p className="bonus-period-reason">
                                    <span>Reason</span> {state.reopen_reason}
                                </p>
                            )}
                        </>
                    )}

                    {state.status === 'open' && (
                        <div className="bonus-period-state-head">
                            Not approved yet — nothing to reopen.
                        </div>
                    )}
                </div>
            )}

            {reopenOpen && (
                <BonusReopenModal
                    periodLabel={periodLabel}
                    onClose={() => setReopenOpen(false)}
                    onConfirm={handleReopen}
                />
            )}
        </section>
    );
};

export default BonusPeriodSettings;
