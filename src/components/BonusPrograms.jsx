import React from 'react';
import './Reports.css';

/**
 * HR > Bonus — the landing grid of bonus programs.
 *
 * Deliberately the same cards as Analytics > Reports, down to reusing Reports.css rather
 * than restyling a near-copy: the two screens are the same gesture (pick a thing, open it),
 * and a reader should not have to learn a second card. Two things differ. The button says
 * "View Bonus" rather than "View Report", because what opens is a working list, not a
 * generated report. And there is no category badge: Reports carries one to sort a dozen
 * cards into families, which is not a job one card has.
 *
 * One program exists so far. The array is what grows.
 */
const BONUS_PROGRAMS = [
    {
        id: 'home-office-transportation',
        title: 'Bonus Home Office / Transportation',
        description: 'Monthly home office and transportation compensation, prorated by the days each employee actually worked.',
        icon: '🏠',
        status: 'active'
    }
];

const BonusPrograms = ({ onOpenBonus }) => (
    <div className="reports-container">
        <header className="reports-header">
            <h1>Bonus</h1>
            <p>Select a bonus program to review and edit the amounts earned this month.</p>
        </header>

        <div className="reports-grid">
            {BONUS_PROGRAMS.map((program) => (
                <div
                    key={program.id}
                    className={`report-card ${program.status}`}
                    onClick={() => program.status === 'active' && onOpenBonus(program.id)}
                >
                    <div className="report-icon">{program.icon}</div>
                    <div className="report-content">
                        <h3>{program.title}</h3>
                        <p>{program.description}</p>
                    </div>
                    <div className="report-footer">
                        {program.status === 'active' ? (
                            <button className="view-report-btn">View Bonus</button>
                        ) : (
                            <span className="coming-soon">Coming Soon</span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    </div>
);

export default BonusPrograms;
