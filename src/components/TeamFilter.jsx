import React, { useState } from 'react';

/**
 * Team dropdown shared by the report views. Its styling lives in StatReportView.css
 * (.team-filter-dropdown / .filter-trigger / .dropdown-menu), which every consumer
 * already imports for the report shell.
 *
 * Selection state and persistence stay with the caller — see loadTeamFilter /
 * saveTeamFilter in src/reportPreferences.js.
 *
 * The menu will not close with no team selected. An empty selection hides the views that
 * hold this filter (the Run Rate projection shows only "No teams to project"), so closing
 * on it left no way back to pick a team.
 */
const TeamFilter = ({ teams, selectedTeams, onToggle, onSelectAll, onClearAll }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [showMinHint, setShowMinHint] = useState(false);

    const mustPickOne = teams.length > 0 && selectedTeams.size === 0;

    const close = () => {
        if (mustPickOne) {
            setShowMinHint(true);
            return;
        }
        setShowMinHint(false);
        setIsOpen(false);
    };

    return (
        <div className="team-filter-dropdown">
            <button className={`filter-trigger ${selectedTeams.size < teams.length ? 'has-active' : ''}`} onClick={() => (isOpen ? close() : setIsOpen(true))}>
                <span className="filter-icon">🔍</span>
                <span className="filter-label">
                    {selectedTeams.size === teams.length ? 'All Teams' : `${selectedTeams.size} Selected`}
                </span>
                <span className="arrow">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
                <>
                    <div className="dropdown-overlay" onClick={close} />
                    <div className="dropdown-menu">
                        <div className="dropdown-header">
                            <button onClick={onSelectAll}>Select All</button>
                            <button onClick={onClearAll}>Clear All</button>
                        </div>
                        {mustPickOne && (
                            <div className={`dropdown-min-hint ${showMinHint ? 'is-alert' : ''}`}>
                                Select at least one team.
                            </div>
                        )}
                        <div className="team-options">
                            {teams.map(team => (
                                <label key={team} className="team-option">
                                    <input
                                        type="checkbox"
                                        checked={selectedTeams.has(team)}
                                        onChange={() => onToggle(team)}
                                    />
                                    <span>{team}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default TeamFilter;
