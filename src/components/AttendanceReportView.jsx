import React, { useState, useEffect, useMemo } from 'react';
import './StatReportView.css';
import './AttendanceReportView.css';
import LoadingScreen from './LoadingScreen';
import TeamFilter from './TeamFilter';
import { loadTeamFilter, saveTeamFilter, loadViewMode, saveViewMode } from '../reportPreferences';
import { normalizeForSearch } from '../utils/search';

// Raw is first and is the default: it shows the rows exactly as the query returned
// them, which is the view to fall back on when a grouped total looks wrong.
const VIEW_MODES = [
    { id: 'raw', label: 'Raw', hint: 'Rows exactly as they come from the database' },
    { id: 'date', label: 'Date View', hint: 'Grouped by absence date' },
    { id: 'employee', label: 'Employee View', hint: 'One row per employee, with every absence date' },
    { id: 'team', label: 'Team View', hint: 'Grouped by team' }
];

const VIEW_MODE_STORAGE_KEY = 'attendance_report_view';
const VIEW_MODE_IDS = VIEW_MODES.map(mode => mode.id);

const formatLongDate = (dateStr) => {
    if (!dateStr) return '-';
    // Noon-anchored so the calendar day cannot slip across midnight in another timezone.
    return new Date(`${dateStr.slice(0, 10)}T12:00:00`)
        .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

// Compact form for the header badge: the weekday is noise on a range's endpoints.
const formatRangeDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(`${dateStr.slice(0, 10)}T12:00:00`)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatTime = (t) => {
    if (!t || t === '00:00:00') return '-';
    const [h, m] = t.split(':');
    const hour = parseInt(h, 10);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
};

const formatShift = (row) => `${formatTime(row.work_starts)} - ${formatTime(row.work_ends)}`;

const hours = (value) => `${Number(value || 0).toFixed(1)}h`;

// Wrap every cell: names and team names carry commas often enough to break a naive join.
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const AttendanceReportView = ({ fromDate, toDate, onBack }) => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [viewMode, setViewMode] = useState(() => loadViewMode(VIEW_MODE_STORAGE_KEY, VIEW_MODE_IDS, 'raw'));
    const [searchTerm, setSearchTerm] = useState('');
    const [teamOverride, setTeamOverride] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(`./api/get_attendance_details.php?from=${fromDate}&to=${toDate}`);
                const result = await response.json();
                if (result.success) {
                    setRows(result.data || []);
                } else {
                    setError(result.error || 'Failed to load attendance data.');
                }
            } catch {
                setError('Failed to fetch attendance data.');
            } finally {
                setLoading(false);
            }
        };

        if (fromDate && toDate) fetchData();
    }, [fromDate, toDate]);

    // Only teams that actually have an absence in this range: the report lists
    // exceptions, so a team with full attendance has nothing to filter to.
    const availableTeams = useMemo(
        () => Array.from(new Set(rows.map(row => row.team_name || 'Unassigned'))).sort(),
        [rows]
    );

    // Derived rather than seeded by an effect: an effect only runs after the first
    // paint, which would flash an unfiltered (or empty) table before settling.
    // `teamOverride` stays null until the user touches the dropdown, and until then
    // the selection is whatever was stored last, narrowed to the teams present here.
    const selectedTeams = useMemo(() => {
        if (teamOverride) {
            return new Set([...teamOverride].filter(team => availableTeams.includes(team)));
        }
        const saved = loadTeamFilter();
        return saved !== null
            ? new Set(saved.filter(team => availableTeams.includes(team)))
            : new Set(availableTeams);
    }, [teamOverride, availableTeams]);

    const handleToggleTeam = (team) => {
        const next = new Set(selectedTeams);
        if (next.has(team)) next.delete(team);
        else next.add(team);
        setTeamOverride(next);
        saveTeamFilter(next);
    };

    const handleSelectAllTeams = () => {
        const next = new Set(availableTeams);
        setTeamOverride(next);
        saveTeamFilter(next);
    };

    const handleClearAllTeams = () => {
        const next = new Set();
        setTeamOverride(next);
        saveTeamFilter(next);
    };

    const handleChangeViewMode = (nextView) => {
        setViewMode(nextView);
        saveViewMode(VIEW_MODE_STORAGE_KEY, nextView);
    };

    const filteredRows = useMemo(() => {
        const term = normalizeForSearch(searchTerm.trim());
        return rows.filter(row => {
            if (!selectedTeams.has(row.team_name || 'Unassigned')) return false;
            if (!term) return true;
            return normalizeForSearch(row.name).includes(term) ||
                normalizeForSearch(row.team_name).includes(term);
        });
    }, [rows, searchTerm, selectedTeams]);

    const totals = useMemo(() => ({
        absences: filteredRows.length,
        employees: new Set(filteredRows.map(row => row.employee_id)).size,
        lostHours: filteredRows.reduce((sum, row) => sum + Number(row.lost_hours || 0), 0)
    }), [filteredRows]);

    // Date view: newest day first, employees alphabetical inside each day.
    const dateGroups = useMemo(() => {
        const map = new Map();
        filteredRows.forEach(row => {
            if (!map.has(row.log_date)) map.set(row.log_date, []);
            map.get(row.log_date).push(row);
        });
        return Array.from(map.entries())
            .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
            .map(([logDate, items]) => ({
                key: logDate,
                items: [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
                lostHours: items.reduce((sum, row) => sum + Number(row.lost_hours || 0), 0)
            }));
    }, [filteredRows]);

    // Employee view: the name appears once, carrying its absence count and dates.
    const employeeGroups = useMemo(() => {
        const map = new Map();
        filteredRows.forEach(row => {
            if (!map.has(row.employee_id)) {
                map.set(row.employee_id, {
                    employee_id: row.employee_id,
                    name: row.name,
                    team_name: row.team_name,
                    dates: [],
                    lostHours: 0
                });
            }
            const entry = map.get(row.employee_id);
            // Each date carries its own lost hours: shifts differ per day, so a flat
            // date list would hide which absence actually cost the most.
            entry.dates.push({ date: row.log_date, lostHours: Number(row.lost_hours || 0) });
            entry.lostHours += Number(row.lost_hours || 0);
        });
        return Array.from(map.values())
            .map(entry => ({
                ...entry,
                dates: [...entry.dates].sort((a, b) => String(b.date).localeCompare(String(a.date)))
            }))
            // Worst offenders first; ties broken by name so the order is stable.
            .sort((a, b) => (b.dates.length - a.dates.length) || String(a.name || '').localeCompare(String(b.name || '')));
    }, [filteredRows]);

    const teamGroups = useMemo(() => {
        const map = new Map();
        filteredRows.forEach(row => {
            const team = row.team_name || 'Unassigned';
            if (!map.has(team)) map.set(team, []);
            map.get(team).push(row);
        });
        return Array.from(map.entries())
            .map(([team, items]) => ({
                key: team,
                items: [...items].sort((a, b) =>
                    String(b.log_date || '').localeCompare(String(a.log_date || '')) ||
                    String(a.name || '').localeCompare(String(b.name || ''))
                ),
                employees: new Set(items.map(row => row.employee_id)).size,
                lostHours: items.reduce((sum, row) => sum + Number(row.lost_hours || 0), 0)
            }))
            .sort((a, b) => (b.items.length - a.items.length) || String(a.key).localeCompare(String(b.key)));
    }, [filteredRows]);

    // The CSV mirrors whatever view is on screen, so exporting is never a surprise.
    const handleExportCSV = () => {
        if (!filteredRows.length) return;

        let headers = [];
        let csvRows = [];

        if (viewMode === 'employee') {
            headers = ['Name', 'Team', 'Absences', 'Absence Dates', 'Lost Hours'];
            csvRows = employeeGroups.map(entry => [
                csvCell(entry.name),
                csvCell(entry.team_name),
                entry.dates.length,
                csvCell(entry.dates.map(item => `${item.date} (${hours(item.lostHours)})`).join(' | ')),
                entry.lostHours.toFixed(2)
            ]);
        } else if (viewMode === 'team') {
            headers = ['Team', 'Name', 'Absence Date', 'Scheduled Shift', 'Lost Hours'];
            csvRows = teamGroups.flatMap(group => group.items.map(row => [
                csvCell(group.key),
                csvCell(row.name),
                csvCell(row.log_date),
                csvCell(formatShift(row)),
                Number(row.lost_hours || 0).toFixed(2)
            ]));
        } else if (viewMode === 'date') {
            headers = ['Absence Date', 'Name', 'Team', 'Scheduled Shift', 'Lost Hours'];
            csvRows = dateGroups.flatMap(group => group.items.map(row => [
                csvCell(row.log_date),
                csvCell(row.name),
                csvCell(row.team_name),
                csvCell(formatShift(row)),
                Number(row.lost_hours || 0).toFixed(2)
            ]));
        } else {
            headers = ['Name', 'Team', 'Absence Date', 'Scheduled Shift', 'Lost Hours'];
            csvRows = filteredRows.map(row => [
                csvCell(row.name),
                csvCell(row.team_name),
                csvCell(row.log_date),
                csvCell(formatShift(row)),
                Number(row.lost_hours || 0).toFixed(2)
            ]);
        }

        const csvContent = [headers.join(','), ...csvRows.map(row => row.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `Attendance_Report_${viewMode}_${fromDate}_to_${toDate}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const emptyState = (colSpan) => (
        <tr>
            <td colSpan={colSpan} className="report-empty-state">
                {rows.length === 0
                    ? 'No absences found for this date range - every scheduled employee logged in.'
                    : 'No absences match the current team filter or search.'}
            </td>
        </tr>
    );

    const renderRawTable = () => (
        <table className="report-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Team</th>
                    <th>Absence Date</th>
                    <th>Scheduled Shift</th>
                    <th>Lost Hours</th>
                </tr>
            </thead>
            <tbody>
                {filteredRows.map((row, idx) => (
                    <tr key={`${row.employee_id}-${row.log_date}-${idx}`}>
                        <td className="attendance-name-cell">{row.name}</td>
                        <td>{row.team_name}</td>
                        <td>{row.log_date}</td>
                        <td>{formatShift(row)}</td>
                        <td className="attendance-hours-cell">{hours(row.lost_hours)}</td>
                    </tr>
                ))}
                {filteredRows.length === 0 && emptyState(5)}
            </tbody>
        </table>
    );

    const renderDateTable = () => (
        <table className="report-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Team</th>
                    <th>Absence Date</th>
                    <th>Scheduled Shift</th>
                    <th>Lost Hours</th>
                </tr>
            </thead>
            <tbody>
                {dateGroups.map(group => (
                    <React.Fragment key={group.key}>
                        <tr className="attendance-group-row">
                            <td colSpan={5}>
                                <span className="attendance-group-title">{formatLongDate(group.key)}</span>
                                <span className="attendance-group-meta">
                                    {group.items.length} {group.items.length === 1 ? 'absence' : 'absences'} &middot; {hours(group.lostHours)} lost
                                </span>
                            </td>
                        </tr>
                        {group.items.map((row, idx) => (
                            <tr key={`${row.employee_id}-${group.key}-${idx}`}>
                                <td className="attendance-name-cell">{row.name}</td>
                                <td>{row.team_name}</td>
                                <td>{row.log_date}</td>
                                <td>{formatShift(row)}</td>
                                <td className="attendance-hours-cell">{hours(row.lost_hours)}</td>
                            </tr>
                        ))}
                    </React.Fragment>
                ))}
                {dateGroups.length === 0 && emptyState(5)}
            </tbody>
        </table>
    );

    const renderEmployeeTable = () => (
        <table className="report-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Team</th>
                    <th>Absences</th>
                    <th>Absence Dates</th>
                    <th>Lost Hours</th>
                </tr>
            </thead>
            <tbody>
                {employeeGroups.map(entry => (
                    <tr key={entry.employee_id}>
                        <td className="attendance-name-cell">{entry.name}</td>
                        <td>{entry.team_name}</td>
                        <td><span className="attendance-count-badge">{entry.dates.length}</span></td>
                        <td>
                            <div className="attendance-date-chips">
                                {entry.dates.map(item => (
                                    <span key={item.date} className="attendance-date-chip">
                                        {item.date}
                                        <span className="attendance-date-chip-hours">{hours(item.lostHours)}</span>
                                    </span>
                                ))}
                            </div>
                        </td>
                        <td className="attendance-hours-cell">{hours(entry.lostHours)}</td>
                    </tr>
                ))}
                {employeeGroups.length === 0 && emptyState(5)}
            </tbody>
        </table>
    );

    const renderTeamTable = () => (
        <table className="report-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Team</th>
                    <th>Absence Date</th>
                    <th>Scheduled Shift</th>
                    <th>Lost Hours</th>
                </tr>
            </thead>
            <tbody>
                {teamGroups.map(group => (
                    <React.Fragment key={group.key}>
                        <tr className="attendance-group-row">
                            <td colSpan={5}>
                                <span className="attendance-group-title">{group.key}</span>
                                <span className="attendance-group-meta">
                                    {group.items.length} {group.items.length === 1 ? 'absence' : 'absences'} &middot; {group.employees} {group.employees === 1 ? 'employee' : 'employees'} &middot; {hours(group.lostHours)} lost
                                </span>
                            </td>
                        </tr>
                        {group.items.map((row, idx) => (
                            <tr key={`${group.key}-${row.employee_id}-${idx}`}>
                                <td className="attendance-name-cell">{row.name}</td>
                                <td>{row.team_name}</td>
                                <td>{row.log_date}</td>
                                <td>{formatShift(row)}</td>
                                <td className="attendance-hours-cell">{hours(row.lost_hours)}</td>
                            </tr>
                        ))}
                    </React.Fragment>
                ))}
                {teamGroups.length === 0 && emptyState(5)}
            </tbody>
        </table>
    );

    if (loading) return <LoadingScreen loading={loading} message="Preparing Attendance Report..." />;
    if (error) return <div className="error-message">{error}</div>;

    return (
        <div className="stat-report-container">
            <div className="report-header">
                <button className="back-btn" onClick={onBack}>&larr; Back</button>
                <h1>Attendance Report</h1>
                <span className="date-range-badge">
                    {formatRangeDate(fromDate)} &ndash; {formatRangeDate(toDate)}
                </span>
            </div>

            <div className="report-content">
                <div className="report-section">
                    <div className="section-header-row">
                        <div className="attendance-heading">
                            <h3>Attendance Exceptions</h3>
                            <span className="attendance-subtitle">
                                {totals.absences} {totals.absences === 1 ? 'absence' : 'absences'} &middot; {totals.employees} {totals.employees === 1 ? 'employee' : 'employees'} &middot; {hours(totals.lostHours)} lost
                            </span>
                        </div>
                        <div className="attendance-toolbar">
                            <input
                                type="text"
                                className="attendance-search"
                                placeholder="Search by name or team..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            <TeamFilter
                                teams={availableTeams}
                                selectedTeams={selectedTeams}
                                onToggle={handleToggleTeam}
                                onSelectAll={handleSelectAllTeams}
                                onClearAll={handleClearAllTeams}
                            />
                            <div className="attendance-view-tabs">
                                {VIEW_MODES.map(mode => (
                                    <button
                                        key={mode.id}
                                        className={`attendance-view-tab ${viewMode === mode.id ? 'is-active' : ''}`}
                                        onClick={() => handleChangeViewMode(mode.id)}
                                        title={mode.hint}
                                    >
                                        {mode.label}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={handleExportCSV}
                                className="export-btn secondary"
                                style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                                disabled={filteredRows.length === 0}
                            >
                                Export CSV
                            </button>
                        </div>
                    </div>

                    <div className="report-table-wrapper">
                        {viewMode === 'raw' && renderRawTable()}
                        {viewMode === 'date' && renderDateTable()}
                        {viewMode === 'employee' && renderEmployeeTable()}
                        {viewMode === 'team' && renderTeamTable()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AttendanceReportView;
