import React, { useState } from 'react';
import './BonusModal.css';
// Where .bonus-form-group and .bonus-input are defined. Imported rather than left to the
// bundle: one stylesheet owns those classes, and this file uses them.
import './AddBonusEmployeeModal.css';
import './BonusApprovalModal.css';

/**
 * "Re-open Bonus Period" — the reason, and nothing else.
 *
 * Clicking Re-open in Configuration > HR does not reopen anything; it opens this. The
 * reason is the point of the whole flow: an approved month is what Finance was told to pay
 * from, so unlocking one has to leave behind a sentence saying why. The button stays
 * disabled until there is one, and a box full of spaces is not one — `.trim()` is what the
 * disabled check reads, and the server checks it again for the same reason.
 */
const BonusReopenModal = ({ periodLabel, onClose, onConfirm }) => {
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const canSubmit = reason.trim() !== '' && !saving;

    const handleConfirm = async () => {
        if (!canSubmit) return;
        setSaving(true);
        setError(null);
        try {
            await onConfirm(reason.trim());
        } catch (err) {
            setError(err.message || 'Could not reopen the period.');
            setSaving(false);
        }
    };

    return (
        <div className="bonus-modal-overlay" onClick={saving ? undefined : onClose}>
            <div className="bonus-modal-panel bonus-reopen-modal" onClick={(e) => e.stopPropagation()}>
                <div className="bonus-modal-header">
                    <div>
                        <h2>Re-open Bonus Period</h2>
                        <span className="bonus-approval-period">{periodLabel}</span>
                    </div>
                    <button className="bonus-modal-close" onClick={onClose} disabled={saving}>
                        &times;
                    </button>
                </div>

                <p className="bonus-modal-intro">
                    Please provide a reason for reopening this bonus period. The list becomes editable
                    again and the reason is kept with the period.
                </p>

                <div className="bonus-form-group">
                    <label htmlFor="bonus-reopen-reason">
                        Reason <span className="bonus-reopen-required">required</span>
                    </label>
                    <textarea
                        id="bonus-reopen-reason"
                        className="bonus-input bonus-reopen-textarea"
                        rows={4}
                        value={reason}
                        onChange={(e) => { setReason(e.target.value); setError(null); }}
                        placeholder="e.g. Two employees were missing from the August list."
                        maxLength={1000}
                        autoFocus
                        disabled={saving}
                    />
                </div>

                {error && <div className="bonus-modal-error">{error}</div>}

                <div className="bonus-modal-footer">
                    <button className="bonus-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
                    <button className="bonus-btn-confirm" onClick={handleConfirm} disabled={!canSubmit}>
                        {saving ? 'Reopening…' : 'Re-open Bonus'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BonusReopenModal;
