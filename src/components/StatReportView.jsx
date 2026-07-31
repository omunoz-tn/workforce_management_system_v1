import React, { useState, useEffect, useMemo } from 'react';
import './StatReportView.css';
import LoadingScreen from './LoadingScreen';
import DrillDownModal from './DrillDownModal';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

// Shared Metric Configuration (should ideally be in a constants file)
const METRIC_CONFIG = {
    'coverage': { title: 'Coverage Report', icon: '🎯', color: '#38a169', type: 'online' },
    'productivity': { title: 'Productivity Report', icon: '⚡', color: '#4299e1', type: 'productivity' },
    'punctuality': { title: 'Punctuality Report', icon: '⏰', color: '#e53e3e', type: 'late' },
    'absenteeism': { title: 'Absenteeism Report', icon: '📉', color: '#e53e3e', type: 'absenteeism' },
    'adherence': { title: 'Adherence Report', icon: '✅', color: '#38a169', type: 'adherence' },
    'overtime': { title: 'Overtime Report', icon: '🕒', color: '#805ad5', type: 'overtime' },
    'total-hours': { title: 'Total Hours Report', icon: '🕐', color: '#3182ce', type: 'totalHours' },
    'run-rate': { title: 'Run Rate Report', icon: '📈', color: '#4c51bf', type: 'runRate' }
};

const TeamFilter = ({ teams, selectedTeams, onToggle, onSelectAll, onClearAll }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="team-filter-dropdown">
            <button className={`filter-trigger ${selectedTeams.size < teams.length ? 'has-active' : ''}`} onClick={() => setIsOpen(!isOpen)}>
                <span className="filter-icon">🔍</span>
                <span className="filter-label">
                    {selectedTeams.size === teams.length ? 'All Teams' : `${selectedTeams.size} Selected`}
                </span>
                <span className="arrow">{isOpen ? '▲' : '▼'}</span>
            </button>
            
            {isOpen && (
                <>
                    <div className="dropdown-overlay" onClick={() => setIsOpen(false)} />
                    <div className="dropdown-menu">
                        <div className="dropdown-header">
                            <button onClick={onSelectAll}>Select All</button>
                            <button onClick={onClearAll}>Clear All</button>
                        </div>
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

const VIEW_MODE_OPTIONS = [
    { id: 'list', label: 'List', icon: ListIcon },
    { id: 'grid', label: 'Grid', icon: GridIcon }
];

const ViewToggle = ({ viewMode, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const ActiveIcon = viewMode === 'grid' ? GridIcon : ListIcon;

    return (
        <div className="view-toggle-dropdown">
            <button className="filter-trigger view-toggle-trigger" onClick={() => setIsOpen(!isOpen)} title="Change view">
                <ActiveIcon />
            </button>

            {isOpen && (
                <>
                    <div className="dropdown-overlay" onClick={() => setIsOpen(false)} />
                    <div className="dropdown-menu view-toggle-menu">
                        {VIEW_MODE_OPTIONS.map(opt => {
                            const OptionIcon = opt.icon;
                            return (
                                <button
                                    key={opt.id}
                                    className={`view-toggle-option ${viewMode === opt.id ? 'is-active' : ''}`}
                                    onClick={() => { onChange(opt.id); setIsOpen(false); }}
                                >
                                    <span className="view-toggle-check">{viewMode === opt.id ? '✓' : ''}</span>
                                    <span className="view-toggle-label">{opt.label}</span>
                                    <span className="view-toggle-icon"><OptionIcon /></span>
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
};

const SortDropdown = ({ sortConfig, onChange, metricLabel }) => {
    const [isOpen, setIsOpen] = useState(false);

    const options = [
        { key: 'group_name', direction: 'asc', label: 'Alphabetical (A → Z)' },
        { key: 'group_name', direction: 'desc', label: 'Alphabetical (Z → A)' },
        { key: 'display_metric', direction: 'desc', label: `${metricLabel}: High to Low` },
        { key: 'display_metric', direction: 'asc', label: `${metricLabel}: Low to High` }
    ];

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

const TEAM_FILTER_STORAGE_KEY = 'stat_report_team_filter';

const loadSavedTeamFilter = () => {
    try {
        const raw = localStorage.getItem(TEAM_FILTER_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const saveTeamFilter = (teamsSet) => {
    try {
        localStorage.setItem(TEAM_FILTER_STORAGE_KEY, JSON.stringify(Array.from(teamsSet)));
    } catch {
        // localStorage unavailable (private browsing, quota, etc.) - filter still works this session
    }
};

const StatReportView = ({ reportId, fromDate, toDate, onBack }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeDrillDown, setActiveDrillDown] = useState(null);
    const [colorRanges, setColorRanges] = useState([]);
    const [selectedTeams, setSelectedTeams] = useState(new Set());
    const [showZeroTeams, setShowZeroTeams] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'group_name', direction: 'asc' });
    const [viewMode, setViewMode] = useState('grid');


    const config = METRIC_CONFIG[reportId] || METRIC_CONFIG['run-rate'];
    const getDefaultSortConfig = (nextReportId) => (
        nextReportId === 'absenteeism'
            ? { key: 'display_metric', direction: 'desc' }
            : { key: 'group_name', direction: 'asc' }
    );

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const endpoint = reportId === 'absenteeism' 
                    ? `./api/get_absenteeism_details.php?from=${fromDate}&to=${toDate}`
                    : `./api/get_dashboard_stats.php?from=${fromDate}&to=${toDate}`;
                
                const response = await fetch(endpoint);
                const result = await response.json();
                if (result.success) {
                    setData(result);
                } else {
                    setError(result.error);
                }
            } catch (err) {
                setError("Failed to fetch report data.");
            } finally {
                setLoading(false);
            }
        };

        if (fromDate && toDate) fetchData();
    }, [reportId, fromDate, toDate]);

    // Initialize selected teams when data loads: restore the last saved filter if
    // one exists (intersected with the teams actually present in this report),
    // otherwise default to all teams selected.
    useEffect(() => {
        if (data?.teamStats) {
            const allTeams = data.teamStats.map(t => t.group_name);
            const saved = loadSavedTeamFilter();

            if (saved !== null) {
                setSelectedTeams(new Set(saved.filter(t => allTeams.includes(t))));
            } else {
                setSelectedTeams(new Set(allTeams));
            }
        }
    }, [data]);

    useEffect(() => {
        if (reportId === 'absenteeism') {
            setShowZeroTeams(false);
        }
        setSortConfig(getDefaultSortConfig(reportId));
    }, [reportId]);

    // Admin-configured Run Rate color bands (Configuración → Reports → Advance
    // Configuration). Fetched separately from the report data itself since it's a
    // different, global data source that doesn't change with the date range.
    useEffect(() => {
        if (reportId !== 'run-rate') {
            setColorRanges([]);
            return;
        }

        fetch('./api/manage_run_rate_ranges.php')
            .then(res => res.json())
            .then(json => { if (json.success) setColorRanges(json.ranges || []); })
            .catch(err => console.error('Failed to load run rate color ranges', err));
    }, [reportId]);

    const stats = data?.stats || {};

    const teamStats = data?.teamStats || [];
    // Excluded employees (Configuration > Reports > Advance Configuration > Run
    // Rate Report > Employees Exceptions) are flagged, not removed, by the
    // backend — filtered out here so every consumer below sees the same roster.
    const mtdEmployeeData = (data?.mtdEmployeeData || []).filter(m => !Number(m.is_excluded));

    const availableTeams = useMemo(() => {
        return (data?.teamStats || []).map(t => t.group_name).sort();
    }, [data]);

    const teamTableColumns = useMemo(() => {
        if (reportId === 'absenteeism') {
            return [
                { id: 'group_name', label: 'Team Name', type: 'string', defaultDirection: 'asc', accessor: (team) => team.group_name || '' },
                { id: 'display_metric', label: 'Absence Rate', type: 'number', defaultDirection: 'desc', accessor: (team) => Number(team.display_metric || 0) },
                { id: 'team_actual', label: 'Total Absences', type: 'number', defaultDirection: 'desc', accessor: (team) => Number(team.team_actual || 0) },
                { id: 'team_scheduled', label: 'Scheduled Shifts', type: 'number', defaultDirection: 'desc', accessor: (team) => Number(team.team_scheduled || 0) },
                { id: 'unique_absentees', label: 'Unique Absentees', type: 'number', defaultDirection: 'desc', accessor: (team) => Number(team.unique_absentees || 0) },
                { id: 'lost_hours', label: 'Lost Hours', type: 'number', defaultDirection: 'desc', accessor: (team) => Number(team.lost_hours || 0) }
            ];
        }

        return [
            { id: 'group_name', label: 'Team Name', type: 'string', defaultDirection: 'asc', accessor: (team) => team.group_name || '' },
            { id: 'display_metric', label: reportId === 'run-rate' ? 'Team Run Rate' : 'Avg. Productivity', type: 'number', defaultDirection: 'desc', accessor: (team) => Number(team.display_metric || 0) },
            { id: 'team_actual', label: 'Actual Hours', type: 'number', defaultDirection: 'desc', accessor: (team) => Number(team.team_actual || 0) },
            { id: 'team_scheduled', label: 'Scheduled Hours', type: 'number', defaultDirection: 'desc', accessor: (team) => Number(team.team_scheduled || 0) },
            ...(reportId === 'run-rate' ? [
                { id: 'missed_hours', label: 'Missed Hours', type: 'number', defaultDirection: 'desc', accessor: (team) => Number(team.missed_hours || 0) }
            ] : []),
            { id: 'from_date', label: 'Start Date', type: 'date', defaultDirection: 'desc', accessor: () => fromDate || '' },
            { id: 'to_date', label: 'End Date', type: 'date', defaultDirection: 'desc', accessor: () => toDate || '' }
        ];
    }, [reportId, fromDate, toDate]);

    const selectedTeamStats = useMemo(() => {
        const statsSource = (data?.teamStats || []);
        const filtered = statsSource.filter(t => selectedTeams.has(t.group_name));

        return filtered.map(team => {
            let display_metric = 0;
            let team_actual = 0;
            let team_scheduled = 0;

            if (reportId === 'absenteeism') {
                const scheduled = parseFloat(team.total_scheduled || 0);
                const absences = parseFloat(team.absence_count || 0);
                display_metric = scheduled > 0 ? (absences / scheduled) * 100 : 0;
                team_actual = absences;
                team_scheduled = scheduled;
            } else if (reportId === 'run-rate' && mtdEmployeeData.length > 0) {
                // Manually calculate run rate for THIS team based on MTD employee data
                const teamMtd = mtdEmployeeData.filter(m => m.team_name === team.group_name);
                if (teamMtd.length > 0) {
                    const actual = teamMtd.reduce((sum, m) => sum + parseFloat(m.mtd_actual || 0), 0);
                    const scheduled = teamMtd.reduce((sum, m) => sum + parseFloat(m.mtd_scheduled || 0), 0);
                    const lunch = teamMtd.reduce((sum, m) => sum + parseFloat(m.lunch_deduction_hours || 0), 0);
                    const adjusted = Math.max(scheduled - lunch, 0);
                    display_metric = adjusted > 0 ? (actual / adjusted) * 100 : 0;
                    team_actual = actual;
                    team_scheduled = adjusted;
                } else {
                    display_metric = 0;
                }
            } else {
                display_metric = parseFloat(team.avg_productivity || 0);
            }

            const missed_hours = Math.max(0, team_scheduled - team_actual);

            return { ...team, display_metric, team_actual, team_scheduled, missed_hours };
        });
    }, [data, selectedTeams, reportId, mtdEmployeeData]);

    const filteredTeamStats = useMemo(() => {
        let rows = [...selectedTeamStats];

        if (reportId === 'absenteeism') {
            if (!showZeroTeams) {
                rows = rows.filter(team => Number(team.display_metric || 0) > 0);
            }
        }

        const activeColumn = teamTableColumns.find(column => column.id === sortConfig.key) || teamTableColumns[0];
        const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1;

        const compareValues = (valueA, valueB, type) => {
            if (type === 'number') {
                return Number(valueA || 0) - Number(valueB || 0);
            }

            if (type === 'date') {
                const timeA = valueA ? new Date(`${valueA}T00:00:00`).getTime() : 0;
                const timeB = valueB ? new Date(`${valueB}T00:00:00`).getTime() : 0;
                return timeA - timeB;
            }

            return String(valueA || '').localeCompare(String(valueB || ''), undefined, {
                numeric: true,
                sensitivity: 'base'
            });
        };

        rows.sort((a, b) => {
            const primaryComparison = compareValues(
                activeColumn.accessor(a),
                activeColumn.accessor(b),
                activeColumn.type
            );

            if (primaryComparison !== 0) {
                return primaryComparison * directionMultiplier;
            }

            return String(a.group_name || '').localeCompare(String(b.group_name || ''), undefined, {
                numeric: true,
                sensitivity: 'base'
            });
        });

        return rows;
    }, [selectedTeamStats, reportId, showZeroTeams, sortConfig, teamTableColumns]);

    const hiddenZeroTeamsCount = useMemo(() => {
        if (reportId !== 'absenteeism' || showZeroTeams) return 0;

        return selectedTeamStats.filter(team => Number(team.display_metric || 0) <= 0).length;
    }, [reportId, selectedTeamStats, showZeroTeams]);

    const handleToggleTeam = (team) => {
        const next = new Set(selectedTeams);
        if (next.has(team)) next.delete(team);
        else next.add(team);
        setSelectedTeams(next);
        saveTeamFilter(next);
    };

    const handleSelectAllTeams = () => {
        const next = new Set(availableTeams);
        setSelectedTeams(next);
        saveTeamFilter(next);
    };

    const handleClearAllTeams = () => {
        const next = new Set();
        setSelectedTeams(next);
        saveTeamFilter(next);
    };
    const handleSort = (column) => {
        setSortConfig(prev => {
            if (prev.key === column.id) {
                return {
                    key: column.id,
                    direction: prev.direction === 'asc' ? 'desc' : 'asc'
                };
            }

            return {
                key: column.id,
                direction: column.defaultDirection || (column.type === 'string' ? 'asc' : 'desc')
            };
        });
    };

    const handleExportTeamCSV = () => {
        if (!filteredTeamStats.length) return;

        const headers = reportId === 'absenteeism'
            ? ['Team Name', 'Absence Rate (%)', 'Total Absences', 'Scheduled Shifts', 'Unique Absentees', 'Lost Hours', 'Start Date', 'End Date']
            : ['Team Name', reportId === 'run-rate' ? 'Team Run Rate (%)' : 'Avg. Productivity (%)', 'Actual Hours', 'Scheduled Hours', ...(reportId === 'run-rate' ? ['Missed Hours'] : []), 'Start Date', 'End Date'];
        const rows = reportId === 'absenteeism'
            ? filteredTeamStats.map(team => [
                `"${team.group_name}"`,
                parseFloat(team.display_metric).toFixed(1),
                Number(team.team_actual || 0).toFixed(0),
                Number(team.team_scheduled || 0).toFixed(0),
                Number(team.unique_absentees || 0).toFixed(0),
                Number(team.lost_hours || 0).toFixed(2),
                `"${formatDate(fromDate)}"`,
                `"${formatDate(toDate)}"`
            ])
            : filteredTeamStats.map(team => [
                `"${team.group_name}"`,
                parseFloat(team.display_metric).toFixed(1),
                team.team_actual.toFixed(2),
                team.team_scheduled.toFixed(2),
                ...(reportId === 'run-rate' ? [team.missed_hours.toFixed(2)] : []),
                `"${formatDate(fromDate)}"`,
                `"${formatDate(toDate)}"`
            ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `Team_Breakdown_${config.title}_${fromDate}_to_${toDate}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Run Rate logic duplication


    const getMetricColor = (val, invertForAbsenteeism = false) => {
        const threshold = parseFloat(val || 0);

        if (invertForAbsenteeism) {
            if (threshold <= 3) return '#48bb78'; // Green
            if (threshold <= 7) return '#38b2ac'; // Teal
            if (threshold <= 12) return '#f6c23e'; // Yellow/Orange
            return '#f56565'; // Red
        }

        if (threshold < 70) return '#f56565'; // Red
        if (threshold < 85) return '#f6c23e'; // Yellow/Orange
        if (threshold < 95) return '#38b2ac'; // Teal
        return '#48bb78'; // Green
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    // Run Rate health bands: each configured range only has a starting percentage
    // ("floor") — the band that applies is the one with the greatest range_start
    // <= the value, so there's never a gap between bands to fall through. Falls
    // back to the original hardcoded bands (98%+ green, 95-97.99% yellow,
    // 91-94.99% red, <91% red+blinking) when no ranges are configured yet, so an
    // admin who clears every range doesn't blank out everyone's dashboard.
    const getRunRateBand = (val) => {
        const pct = parseFloat(val || 0);

        if (colorRanges.length === 0) {
            if (pct >= 98) return { color: '#99C24D', blinking: false };
            if (pct >= 95) return { color: '#F4D35E', blinking: false };
            if (pct >= 91) return { color: '#D80032', blinking: false };
            return { color: '#D80032', blinking: true };
        }

        const sorted = [...colorRanges].sort((a, b) => Number(b.range_start) - Number(a.range_start));
        const match = sorted.find(r => pct >= Number(r.range_start));

        if (match) {
            return { color: match.color, blinking: !!Number(match.is_blinking) };
        }

        return { color: '#94a3b8', blinking: false };
    };

    // Static-width status bar: size never changes, only color (and a blink for a
    // critically low run rate) communicates the value. Used by both the List table
    // and the Grid cards so they stay visually consistent.
    const renderStatusBar = (val, extraClassName = '') => {
        const isRunRate = reportId === 'run-rate';
        const { color, blinking } = isRunRate
            ? getRunRateBand(val)
            : { color: getMetricColor(val, reportId === 'absenteeism'), blinking: false };

        return (
            <div className={`mini-progress${extraClassName ? ` ${extraClassName}` : ''}`}>
                <div
                    className={`fill${blinking ? ' fill-blinking' : ''}`}
                    style={{ width: '100%', background: color }}
                />
            </div>
        );
    };

    const runRateCalc = useMemo(() => {
        const filteredMtd = (mtdEmployeeData || []).filter(m => selectedTeams.has(m.team_name));
        if (!filteredMtd.length) return { actual: 0, scheduled: 0, adjusted: 0, pct: 0 };
        const actual = filteredMtd.reduce((sum, m) => sum + parseFloat(m.mtd_actual || 0), 0);
        const scheduled = filteredMtd.reduce((sum, m) => sum + parseFloat(m.mtd_scheduled || 0), 0);
        const lunch = filteredMtd.reduce((sum, m) => sum + parseFloat(m.lunch_deduction_hours || 0), 0);
        const adjusted = Math.max(scheduled - lunch, 0);
        const pct = adjusted > 0 ? (actual / adjusted) * 100 : 0;
        return { actual, scheduled, adjusted, pct };
    }, [mtdEmployeeData, selectedTeams]);

    const filteredTotals = useMemo(() => {
        const statsSource = filteredTeamStats || [];
        const totalsSource = reportId === 'absenteeism' ? selectedTeamStats : statsSource;
        if (totalsSource.length === 0) return {
            productivity: 0, coverage: 0, punctuality: 0, 
            absenteeism_pct: 0, absenteeism_count: 0, unique_absentees: 0, lost_hours: 0,
            adherence: 0, overtime_pct: 0, total_hours: 0, 
            employees_tracked: 0, total_employees: 0, online_count: 0,
            scheduled_count: 0, late_count: 0, overtime_count: 0
        };

        const totals = totalsSource.reduce((acc, team) => {
            acc.employee_count += Number(team.employee_count || 0);
            acc.online_count += Number(team.online_count || 0);
            acc.offline_count += Number(team.offline_count || 0);
            acc.late_count += Number(team.late_count || 0);
            acc.scheduled_count += Number(team.scheduled_count || team.total_scheduled || (reportId === 'absenteeism' ? team.unique_absentees : 0) || 0);
            acc.total_productivity += (parseFloat(team.avg_productivity || 0) * Number(team.employee_count || 1));
            acc.total_adherence += (parseFloat(team.avg_adherence || 0) * Number(team.employee_count || 1));
            acc.overtime_count += Number(team.overtime_count || 0);
            acc.low_adherence_count += Number(team.low_adherence_count || 0);
            acc.total_desktime += parseFloat(team.total_desktime || (team.desktime_time || 0));
            acc.tracked_count += Number(team.tracked_count || team.employee_count || 0);
            
            // Absenteeism specific (from get_absenteeism_details)
            acc.absence_count += Number(team.absence_count || 0);
            acc.unique_absentees += Number(team.unique_absentees || 0);
            acc.lost_hours += parseFloat(team.lost_hours || 0);
            
            return acc;
        }, {
            employee_count: 0, online_count: 0, offline_count: 0, 
            late_count: 0, scheduled_count: 0, total_productivity: 0, 
            total_adherence: 0, overtime_count: 0, low_adherence_count: 0,
            total_desktime: 0, tracked_count: 0, absence_count: 0, unique_absentees: 0, lost_hours: 0
        });

        return {
            productivity: totals.employee_count > 0 ? totals.total_productivity / totals.employee_count : 0,
            coverage: totals.scheduled_count > 0 ? (totals.online_count / totals.scheduled_count) * 100 : 0,
            punctuality: totals.scheduled_count > 0 ? (totals.late_count / totals.scheduled_count) * 100 : 0,
            absenteeism_pct: totals.scheduled_count > 0 ? (totals.absence_count / totals.scheduled_count) * 100 : 0,
            absenteeism_count: totals.absence_count,
            unique_absentees: totals.unique_absentees,
            lost_hours: totals.lost_hours.toFixed(1),
            adherence: totals.employee_count > 0 ? totals.total_adherence / totals.employee_count : 0,
            overtime_pct: totals.employee_count > 0 ? (totals.overtime_count / totals.employee_count) * 100 : 0,
            total_hours: (totals.total_desktime / 3600),
            employees_tracked: totals.tracked_count,
            total_employees: totals.employee_count,
            online_count: totals.online_count,
            scheduled_count: totals.scheduled_count,
            late_count: totals.late_count,
            overtime_count: totals.overtime_count,
            low_adherence_count: totals.low_adherence_count
        };
    }, [filteredTeamStats, reportId, selectedTeamStats]);

    const renderGlobalCard = () => {
        let val = '0.0%';
        let sub = '';
        let progress = 0;

        switch(reportId) {
            case 'coverage':
                progress = filteredTotals.coverage;
                val = `${progress.toFixed(1)}%`;
                sub = `${filteredTotals.online_count} / ${filteredTotals.scheduled_count} Employees Presence`;
                break;
            case 'productivity':
                progress = filteredTotals.productivity;
                val = `${progress.toFixed(1)}%`;
                break;
            case 'punctuality':
                progress = filteredTotals.punctuality;
                val = `${progress.toFixed(1)}%`;
                sub = `${filteredTotals.late_count} / ${filteredTotals.scheduled_count} Late Arrivals`;
                break;
            case 'absenteeism':
                progress = filteredTotals.absenteeism_pct;
                val = `${progress.toFixed(1)}%`;
                sub = `${filteredTotals.absenteeism_count} No-Shows | ${filteredTotals.unique_absentees} Unique Absentees | ${filteredTotals.lost_hours} Hours Lost`;
                break;
            case 'adherence':
                progress = filteredTotals.adherence;
                val = `${progress.toFixed(1)}%`;
                sub = `${filteredTotals.low_adherence_count} Out of Adherence (< 90%)`;
                break;
            case 'overtime':
                progress = filteredTotals.overtime_pct;
                val = `${progress.toFixed(1)}%`;
                sub = `${filteredTotals.overtime_count} Overtime Instances`;
                break;
            case 'total-hours':
                val = filteredTotals.total_hours.toLocaleString('en-US', { minimumFractionDigits: 2 });
                progress = filteredTotals.total_employees > 0 ? (filteredTotals.employees_tracked / filteredTotals.total_employees) * 100 : 0;
                sub = `${filteredTotals.employees_tracked} Employees Tracked`;
                break;
            case 'run-rate':
                progress = runRateCalc.pct;
                val = `${progress.toFixed(1)}%`;
                break;
        }

        const missedHours = Math.max(0, runRateCalc.adjusted - runRateCalc.actual);
        const cardLabel = reportId === 'run-rate' ? 'Global Run Rate' : config.title;

        return (
            <div
                className="team-card global-team-card clickable-row"
                onClick={() => setActiveDrillDown({ type: config.type, title: config.title, data: reportId === 'run-rate' ? mtdEmployeeData : undefined })}
                title="Click for the full breakdown"
            >
                <div className="team-card-header">
                    <span className="team-link-btn">{cardLabel}</span>
                    <span className="team-card-metric-value">{val}</span>
                </div>

                {renderStatusBar(progress, 'team-card-progress')}

                {reportId === 'run-rate' ? (
                    <div className="team-card-stats">
                        <div className="team-card-stat">
                            <span className="team-card-stat-label">Actual Hours</span>
                            <span className="team-card-stat-value">{runRateCalc.actual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h</span>
                        </div>
                        <div className="team-card-stat">
                            <span className="team-card-stat-label">Scheduled Hours</span>
                            <span className="team-card-stat-value">{runRateCalc.adjusted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h</span>
                        </div>
                        <div className="team-card-stat">
                            <span className="team-card-stat-label">Missed Hours</span>
                            <span className="team-card-stat-value team-card-stat-missed">{missedHours.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h</span>
                        </div>
                        <div className="team-card-stat team-card-stat-dates">
                            <span className="team-card-stat-label">Date Range</span>
                            <span className="team-card-stat-value">{formatDate(fromDate)} – {formatDate(toDate)}</span>
                        </div>
                    </div>
                ) : sub && (
                    <div className="team-card-stats">
                        <div className="team-card-stat team-card-stat-dates">
                            <span className="team-card-stat-value" style={{ color: reportId === 'absenteeism' ? config.color : undefined }}>{sub}</span>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderTeamCard = (team, idx) => (
        <div
            key={idx}
            className="team-card clickable-row"
            onClick={() => setActiveDrillDown({
                type: config.type,
                title: `${team.group_name} - ${config.title}`,
                data: reportId === 'run-rate' ? mtdEmployeeData : undefined,
                team: team.group_name
            })}
            title={`Click for ${team.group_name} individual breakdown`}
        >
            <div className="team-card-header">
                <span className="team-link-btn">{team.group_name}</span>
                <span className="team-card-metric-value">{parseFloat(team.display_metric).toFixed(1)}%</span>
            </div>

            {renderStatusBar(team.display_metric, 'team-card-progress')}

            <div className="team-card-stats">
                <div className="team-card-stat">
                    <span className="team-card-stat-label">{reportId === 'absenteeism' ? 'Total Absences' : 'Actual Hours'}</span>
                    <span className="team-card-stat-value">
                        {reportId === 'absenteeism'
                            ? Number(team.team_actual || 0).toFixed(0)
                            : `${team.team_actual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`}
                    </span>
                </div>
                <div className="team-card-stat">
                    <span className="team-card-stat-label">{reportId === 'absenteeism' ? 'Scheduled Shifts' : 'Scheduled Hours'}</span>
                    <span className="team-card-stat-value">
                        {reportId === 'absenteeism'
                            ? Number(team.team_scheduled || 0).toFixed(0)
                            : `${team.team_scheduled.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`}
                    </span>
                </div>
                {reportId === 'run-rate' && (
                    <div className="team-card-stat">
                        <span className="team-card-stat-label">Missed Hours</span>
                        <span className="team-card-stat-value team-card-stat-missed">
                            {team.missed_hours.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h
                        </span>
                    </div>
                )}
                {reportId === 'absenteeism' ? (
                    <>
                        <div className="team-card-stat">
                            <span className="team-card-stat-label">Unique Absentees</span>
                            <span className="team-card-stat-value">{Number(team.unique_absentees || 0).toFixed(0)}</span>
                        </div>
                        <div className="team-card-stat">
                            <span className="team-card-stat-label">Lost Hours</span>
                            <span className="team-card-stat-value">{Number(team.lost_hours || 0).toFixed(1)}h</span>
                        </div>
                    </>
                ) : (
                    <div className="team-card-stat team-card-stat-dates">
                        <span className="team-card-stat-label">Date Range</span>
                        <span className="team-card-stat-value">{formatDate(fromDate)} – {formatDate(toDate)}</span>
                    </div>
                )}
            </div>
        </div>
    );

    if (loading) return <LoadingScreen loading={loading} message={`Preparing ${config.title}...`} />;
    if (error) return <div className="error-message">{error}</div>;

    return (
        <div className="stat-report-container">
            <div className="report-header">
                <button className="back-btn" onClick={onBack}>← Back</button>
                <h1>{config.title}</h1>
            </div>

            <div className="report-content">
                {reportId === 'absenteeism' && data?.trend && data.trend.length > 0 && (
                    <div className="report-summary-card trend-card full-width">
                        <div className="section-header">
                            <h3>Absence Trends (Daily)</h3>
                        </div>
                        <div className="trend-chart-container">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data.trend} margin={{ top: 5, right: 0, bottom: 5, left: 0 }}>
                                    <defs>
                                        <linearGradient id="colorAbsence" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#e53e3e" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#e53e3e" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                                    <XAxis 
                                        dataKey="log_date" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fontSize: 10, fill: '#718096' }}
                                        tickFormatter={(str) => new Date(str + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                                    />
                                    <YAxis 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fontSize: 10, fill: '#718096' }}
                                        width={25}
                                    />
                                    <Tooltip 
                                        contentStyle={{ 
                                            borderRadius: '8px', 
                                            border: 'none', 
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                            fontSize: '0.85rem'
                                        }}
                                        formatter={(value, name, item) => {
                                            if (name === 'No-Shows') {
                                                return [
                                                    `${value} no-shows (${Number(item?.payload?.absence_rate || 0).toFixed(1)}%)`,
                                                    'No-Shows'
                                                ];
                                            }
                                            return [value, name];
                                        }}
                                        labelFormatter={(str) => new Date(str + 'T12:00:00').toLocaleDateString('en-US', { dateStyle: 'long' })}
                                    />
                                    <Area 
                                        type="monotone" 
                                        dataKey="absence_count" 
                                        name="No-Shows"
                                        stroke="#e53e3e" 
                                        strokeWidth={3}
                                        fillOpacity={1} 
                                        fill="url(#colorAbsence)" 
                                        dot={{ r: 4, fill: '#e53e3e', strokeWidth: 2, stroke: '#fff' }}
                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                <div className="report-section">
                    <div className="section-header-row">
                        <h3>Team Breakdown</h3>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button 
                                onClick={handleExportTeamCSV} 
                                className="export-btn secondary"
                                style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                            >
                                Export CSV
                            </button>
                            {reportId === 'absenteeism' && (
                                <button
                                    onClick={() => setShowZeroTeams(prev => !prev)}
                                    className={`zero-teams-toggle ${showZeroTeams ? 'is-active' : ''}`}
                                    title={showZeroTeams ? 'Hide teams with 0% absence rate' : 'Show teams with 0% absence rate'}
                                >
                                    {showZeroTeams ? 'Hide 0% Teams' : `Show 0% Teams${hiddenZeroTeamsCount > 0 ? ` (${hiddenZeroTeamsCount} hidden)` : ''}`}
                                </button>
                            )}
                            <TeamFilter
                                teams={availableTeams}
                                selectedTeams={selectedTeams}
                                onToggle={handleToggleTeam}
                                onSelectAll={handleSelectAllTeams}
                                onClearAll={handleClearAllTeams}
                            />
                            {viewMode === 'grid' && (
                                <SortDropdown
                                    sortConfig={sortConfig}
                                    onChange={setSortConfig}
                                    metricLabel={teamTableColumns.find(c => c.id === 'display_metric')?.label || 'Metric'}
                                />
                            )}
                            <ViewToggle viewMode={viewMode} onChange={setViewMode} />
                        </div>
                    </div>
                    {viewMode === 'grid' ? (
                        <div className="team-cards-wrapper">
                            <div className="team-cards-grid">
                                {renderGlobalCard()}
                                {filteredTeamStats.map((team, idx) => renderTeamCard(team, idx))}
                            </div>
                            {filteredTeamStats.length === 0 && (
                                <div className="report-empty-state">
                                    {reportId === 'absenteeism' && hiddenZeroTeamsCount > 0
                                        ? 'No teams with absenteeism in this range. Use "Show 0% Teams" to list all teams.'
                                        : 'No teams found for the current filters.'}
                                </div>
                            )}
                        </div>
                    ) : (
                    <div className="report-table-wrapper">

                        <table className="report-table">
                            <thead>
                                <tr>
                                    {teamTableColumns.map((column) => (
                                        <th
                                            key={column.id}
                                            className={`sortable-header ${sortConfig.key === column.id ? 'is-active' : ''}`}
                                            onClick={() => handleSort(column)}
                                            title={`Sort by ${column.label}`}
                                        >
                                            <span className="sortable-header-content">
                                                <span>{column.label}</span>
                                                <span className="sort-indicator">
                                                    {sortConfig.key === column.id ? (
                                                        <span
                                                            className={`sort-indicator-single sort-arrow ${sortConfig.direction === 'asc' ? 'sort-arrow-up' : 'sort-arrow-down'}`}
                                                            aria-hidden="true"
                                                        />
                                                    ) : (
                                                        <span className="sort-indicator-both" aria-hidden="true">
                                                            <span className="sort-arrow sort-arrow-up" />
                                                            <span className="sort-arrow sort-arrow-down" />
                                                        </span>
                                                    )}
                                                </span>
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTeamStats.map((team, idx) => (
                                <tr 
                                    key={idx} 
                                    className="clickable-row"
                                    onClick={() => setActiveDrillDown({ 
                                        type: config.type, 
                                        title: `${team.group_name} - ${config.title}`, 
                                        data: reportId === 'run-rate' ? mtdEmployeeData : undefined,
                                        team: team.group_name
                                    })}
                                    title={`Click for ${team.group_name} individual breakdown`}
                                >
                                    <td>
                                        <span className="team-link-btn">
                                            {team.group_name}
                                        </span>
                                    </td>
                                        <td>
                                            <div className="table-metric">
                                                <span>{parseFloat(team.display_metric).toFixed(1)}%</span>
                                                {renderStatusBar(team.display_metric)}
                                            </div>
                                        </td>
                                        <td>{reportId === 'absenteeism' ? Number(team.team_actual || 0).toFixed(0) : team.team_actual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {reportId === 'absenteeism' ? '' : 'h'}</td>
                                        <td>{reportId === 'absenteeism' ? Number(team.team_scheduled || 0).toFixed(0) : team.team_scheduled.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {reportId === 'absenteeism' ? '' : 'h'}</td>
                                        {reportId === 'run-rate' && (
                                            <td>{team.missed_hours.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h</td>
                                        )}
                                        <td>{reportId === 'absenteeism' ? Number(team.unique_absentees || 0).toFixed(0) : formatDate(fromDate)}</td>
                                        <td>{reportId === 'absenteeism' ? `${Number(team.lost_hours || 0).toFixed(1)}h` : formatDate(toDate)}</td>
                                    </tr>
                                ))}
                                {filteredTeamStats.length === 0 && (
                                    <tr>
                                        <td colSpan={teamTableColumns.length} className="report-empty-state">
                                            {reportId === 'absenteeism' && hiddenZeroTeamsCount > 0
                                                ? 'No teams with absenteeism in this range. Use "Show 0% Teams" to list all teams.'
                                                : 'No teams found for the current filters.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                        </div>
                    )}
                </div>
            </div>


            {activeDrillDown && (
                <DrillDownModal
                    type={activeDrillDown.type}
                    title={activeDrillDown.title}
                    team={activeDrillDown.team}
                    fromDate={fromDate}
                    toDate={toDate}
                    onClose={() => setActiveDrillDown(null)}
                    initialData={activeDrillDown.data}
                    serverTime={data?.lastUpdate}
                />
            )}
        </div>
    );
};

export default StatReportView;
