import React from 'react';
import './BonusModal.css';
import './BonusTeamModal.css';
import { currencyClass, currencyOf, formatBonusAmount } from '../utils/currency';

/**
 * What one team's bonus month looks like, opened from its card in the Grid view.
 *
 * Read-only on purpose. The Grid is the summary view; a card answers "how is this team
 * doing", and answering it should not put the reader one stray keystroke away from changing
 * a payout. Editing is a deliberate second step — the Edit button, which drops into the List
 * view already filtered to this team.
 *
 * `rows` are the same row objects the List view renders, already narrowed to this team.
 */
const BonusTeamModal = ({ team, rows = [], periodLabel, totals, onClose, onEdit }) => (
    <div className="bonus-modal-overlay" onClick={onClose}>
        <div className="bonus-modal-panel bonus-team-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bonus-modal-header">
                <div>
                    <h2>{team}</h2>
                    <span className="bonus-team-period">{periodLabel}</span>
                </div>
                <button className="bonus-modal-close" onClick={onClose}>&times;</button>
            </div>

            <div className="bonus-team-totals">
                <div className="bonus-team-total">
                    <span className="bonus-team-total-label">Employees</span>
                    <span className="bonus-team-total-value">{rows.length}</span>
                </div>
                {Array.from(totals.entries()).map(([code, amounts]) => (
                    <div className="bonus-team-total" key={code}>
                        <span className="bonus-team-total-label">
                            Total Earned ({currencyOf(code).symbol})
                        </span>
                        <span className={`bonus-team-total-value ${currencyClass(code)}`}>
                            {formatBonusAmount(amounts.earned, code)}
                        </span>
                        <span className="bonus-team-total-sub">
                            of {formatBonusAmount(amounts.budget, code)}
                        </span>
                    </div>
                ))}
            </div>

            <div className="bonus-team-table-wrapper">
                <table className="bonus-team-table">
                    <thead>
                        <tr>
                            <th>Employee Name</th>
                            <th className="is-numeric">Days / Workdays</th>
                            <th className="is-numeric">Bonus Amount</th>
                            <th className="is-numeric">Total Earned</th>
                            <th>Comments</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr key={row.id}>
                                <td>{row.employee_name}</td>
                                <td className="is-numeric">{row.days_worked} / {row.workdays}</td>
                                <td className={`is-numeric ${currencyClass(row.currency)}`}>
                                    {formatBonusAmount(row.bonus_amount, row.currency)}
                                </td>
                                <td className={`is-numeric is-strong ${currencyClass(row.currency)}`}>
                                    {formatBonusAmount(row.total_earned, row.currency)}
                                </td>
                                <td className="bonus-team-comment">{row.comments || '—'}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={5} className="bonus-team-empty">
                                    No employees on this team's bonus list.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="bonus-modal-footer">
                <button className="bonus-btn-cancel" onClick={onClose}>Close</button>
                <button className="bonus-btn-confirm" onClick={onEdit}>Edit</button>
            </div>
        </div>
    </div>
);

export default BonusTeamModal;
