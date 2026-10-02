import React from 'react';

/**
 * Grid / List switch shared by the report-style screens (the Run Rate and its sibling stat
 * reports, HR > Bonus). Like TeamFilter, its styling lives in StatReportView.css
 * (.view-toggle-dropdown / .filter-trigger), which every consumer already imports for the
 * report shell.
 *
 * A plain toggle, not a menu: with exactly two views, a dropdown costs two clicks and a
 * decision to do what one click can. It shows the icon of the view you are ON — the button
 * reads as "you are looking at this" — and the tooltip names where pressing takes you, which
 * is the part an icon alone cannot say.
 *
 * `viewMode` and its persistence stay with the caller.
 */

const ListIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
);

const GridIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
);

const ViewToggle = ({ viewMode, onChange }) => {
    const isGrid = viewMode === 'grid';
    const ActiveIcon = isGrid ? GridIcon : ListIcon;

    return (
        <div className="view-toggle-dropdown">
            <button
                className="filter-trigger view-toggle-trigger"
                onClick={() => onChange(isGrid ? 'list' : 'grid')}
                title={`${isGrid ? 'Grid' : 'List'} view — switch to ${isGrid ? 'List' : 'Grid'}`}
                aria-label={`Switch to ${isGrid ? 'List' : 'Grid'} view`}
            >
                <ActiveIcon />
            </button>
        </div>
    );
};

export default ViewToggle;
