import React, { useEffect, useState } from 'react';
import './BonusModal.css';
import './BonusApprovalModal.css';
import { currencyClass, formatBonusAmount } from '../utils/currency';

/**
 * "Approve Bonuses" — the review, then the confirmation, in one modal with two stages.
 *
 * Two stages rather than two modals because they are one decision: the review is what the
 * confirmation is based on, and stacking a second dialog over the first would hide the
 * findings at the moment they matter most. Back is always available, so nothing here is a
 * one-way door until the last button.
 *
 * The review runs on open and writes NOTHING — it is a read of the month the server already
 * computed, reported back. That is why it can run on every click without being something
 * the user has to undo, and why a warning never blocks the approval: an employee with zero
 * days worked may be exactly right, and only a person can say.
 *
 * Nothing is approved until the second stage's button is pressed. Cancelling at either
 * stage approves nothing and sends nothing.
 */

const CheckIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const WarnIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

const BonusApprovalModal = ({ year, month, periodLabel, onClose, onApproved }) => {
    // 'review' -> 'confirm'. The server is asked once, on open; moving between the stages
    // is local, so going back and forth cannot produce two different sets of numbers.
    const [stage, setStage] = useState('review');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [approving, setApproving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        fetch('./api/manage_bonus_approval.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'review', year, month })
        })
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (!json.success) throw new Error(json.error || 'Could not review the bonus list.');
                setData(json);
            })
            .catch(err => { if (!cancelled) setError(err.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [year, month]);

    const handleApprove = async () => {
        setApproving(true);
        setError(null);
        try {
            const res = await fetch('./api/manage_bonus_approval.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'approve', year, month })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'The approval failed.');
            onApproved(json);
        } catch (err) {
            setError(err.message);
            setApproving(false);
        }
    };

    const review = data?.review;
    const totals = data?.totals;
    const attention = review?.attention_count ?? 0;

    return (
        <div className="bonus-modal-overlay" onClick={approving ? undefined : onClose}>
            <div className="bonus-modal-panel bonus-approval-modal" onClick={(e) => e.stopPropagation()}>
                <div className="bonus-modal-header">
                    <div>
                        <h2>{stage === 'review' ? 'Bonus Review' : 'Approve Bonuses'}</h2>
                        <span className="bonus-approval-period">{periodLabel}</span>
                    </div>
                    <button className="bonus-modal-close" onClick={onClose} disabled={approving}>
                        &times;
                    </button>
                </div>

                {loading && <p className="bonus-days-status">Reviewing the list…</p>}
                {error && <div className="bonus-modal-error">{error}</div>}

                {data && stage === 'review' && (
                    <>
                        <p className="bonus-modal-intro">
                            Checked against the {review.employees} employee{review.employees === 1 ? '' : 's'} on
                            the {periodLabel} list. Nothing has been changed or approved yet — this is a read of
                            the figures the module already calculated.
                        </p>

                        <ul className="bonus-review-checks">
                            {review.checks.map(check => (
                                <li key={check.id} className={check.passed ? 'is-passed' : 'is-failed'}>
                                    <span className="bonus-review-icon">
                                        {check.passed ? <CheckIcon /> : <WarnIcon />}
                                    </span>
                                    <span className="bonus-review-label">{check.label}</span>
                                    {!check.passed && (
                                        <span className="bonus-review-count">
                                            {check.failed} to fix
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>

                        {attention > 0 && (
                            <div className="bonus-review-attention">
                                <div className="bonus-review-attention-head">
                                    <WarnIcon />
                                    {attention} employee{attention === 1 ? '' : 's'} require
                                    {attention === 1 ? 's' : ''} attention
                                </div>
                                <ul>
                                    {review.attention.map(item => (
                                        <li key={item.employee_name}>
                                            <strong>{item.employee_name}</strong> — {item.issues.join(', ')}
                                        </li>
                                    ))}
                                </ul>
                                <p className="bonus-review-attention-note">
                                    These are for you to look at, not blockers — nothing has been altered, and
                                    you can still approve. Cancel if you would rather fix them first.
                                </p>
                            </div>
                        )}

                        {attention === 0 && (
                            <div className="bonus-review-clean">
                                <CheckIcon /> Nothing on this list needs attention.
                            </div>
                        )}
                    </>
                )}

                {data && stage === 'confirm' && (
                    <>
                        <p className="bonus-modal-intro">
                            You are about to approve the bonuses for <strong>{periodLabel}</strong>.
                        </p>

                        <div className="bonus-approval-summary">
                            <div className="bonus-approval-figure">
                                <span className="bonus-approval-figure-label">Total Employees</span>
                                <span className="bonus-approval-figure-value">{totals.employees}</span>
                            </div>
                            <div className="bonus-approval-figure">
                                <span className="bonus-approval-figure-label">Total USD</span>
                                <span className={`bonus-approval-figure-value ${currencyClass('USD')}`}>
                                    {formatBonusAmount(totals.USD, 'USD')}
                                </span>
                            </div>
                            <div className="bonus-approval-figure">
                                <span className="bonus-approval-figure-label">Total DOP</span>
                                <span className={`bonus-approval-figure-value ${currencyClass('DOP')}`}>
                                    {formatBonusAmount(totals.DOP, 'DOP')}
                                </span>
                            </div>
                        </div>

                        {attention > 0 && (
                            <div className="bonus-approval-carried-warning">
                                <WarnIcon />
                                {attention} employee{attention === 1 ? '' : 's'} flagged in the review
                                {attention === 1 ? ' is' : ' are'} included in these totals.
                            </div>
                        )}

                        <p className="bonus-approval-lock-note">
                            Once approved, the bonus calculations will be locked and cannot be modified
                            unless the bonus period is reopened from Configuration &gt; HR.
                        </p>
                    </>
                )}

                <div className="bonus-modal-footer">
                    {stage === 'confirm' ? (
                        <button
                            className="bonus-btn-cancel"
                            onClick={() => setStage('review')}
                            disabled={approving}
                        >
                            Back
                        </button>
                    ) : (
                        <button className="bonus-btn-cancel" onClick={onClose}>Cancel</button>
                    )}

                    {stage === 'review' ? (
                        <button
                            className="bonus-btn-confirm"
                            onClick={() => setStage('confirm')}
                            disabled={!data || loading}
                        >
                            Continue
                        </button>
                    ) : (
                        <button
                            className="bonus-btn-confirm"
                            onClick={handleApprove}
                            disabled={approving}
                        >
                            {approving ? 'Approving…' : 'Approve Bonuses'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BonusApprovalModal;
