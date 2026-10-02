import React, { useState } from 'react';

/**
 * Card sort menu shared by the Run Rate Report's actual and projected team grids. Its
 * styling lives in StatReportView.css (.view-toggle-dropdown / .sort-dropdown-*), which
 * every consumer already imports for the report shell.
 *
 * `metricLabel` names the numeric option ("Team Run Rate: High to Low"). `options`
 * replaces the default four when a screen sorts by a different metric key.
 */
const defaultOptions = (metricLabel) => [
    { key: 'group_name', direction: 'asc', label: 'Alphabetical (A → Z)' },
    { key: 'group_name', direction: 'desc', label: 'Alphabetical (Z → A)' },
    { key: 'display_metric', direction: 'desc', label: `${metricLabel}: High to Low` },
    { key: 'display_metric', direction: 'asc', label: `${metricLabel}: Low to High` }
];

const SortDropdown = ({ sortConfig, onChange, metricLabel, options: customOptions }) => {
    const [isOpen, setIsOpen] = useState(false);

    const options = customOptions || defaultOptions(metricLabel);

    const activeLabel = options.find(opt => opt.key === sortConfig.key && opt.direction === sortConfig.direction)?.label || 'Sort';

    return (
        <div className="view-toggle-dropdown">
            <button className="filter-trigger sort-dropdown-trigger" onClick={() => setIsOpen(!isOpen)} title="Sort cards">
                <span className="sort-dropdown-icon">⇅</span>
                <span className="sort-dropdown-label">{activeLabel}</span>
            </button>

            {isOpen && (
                <>
                    <div className="dropdown-overlay" onClick={() => setIsOpen(false)} />
                    <div className="dropdown-menu sort-dropdown-menu">
                        {options.map(opt => (
                            <button
                                key={`${opt.key}-${opt.direction}`}
                                className={`view-toggle-option ${sortConfig.key === opt.key && sortConfig.direction === opt.direction ? 'is-active' : ''}`}
                                onClick={() => { onChange({ key: opt.key, direction: opt.direction }); setIsOpen(false); }}
                            >
                                <span className="view-toggle-check">{sortConfig.key === opt.key && sortConfig.direction === opt.direction ? '✓' : ''}</span>
                                <span className="view-toggle-label">{opt.label}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default SortDropdown;
