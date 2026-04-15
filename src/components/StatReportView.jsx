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


const StatReportView = ({ reportId, fromDate, toDate, onBack }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeDrillDown, setActiveDrillDown] = useState(null);
    const [selectedTeams, setSelectedTeams] = useState(new Set());


    const config = METRIC_CONFIG[reportId] || METRIC_CONFIG['run-rate'];

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

    // Initialize selected teams when data loads
    useEffect(() => {
        if (data?.teamStats) {
            setSelectedTeams(new Set(data.teamStats.map(t => t.group_name)));
        }
    }, [data]);

    const stats = data?.stats || {};

    const teamStats = data?.teamStats || [];
    const mtdEmployeeData = data?.mtdEmployeeData || [];

    const availableTeams = useMemo(() => {
        return (data?.teamStats || []).map(t => t.group_name).sort();
    }, [data]);

    const filteredTeamStats = useMemo(() => {
        const statsSource = (data?.teamStats || []);
        const filtered = statsSource.filter(t => selectedTeams.has(t.group_name));

        return filtered.map(team => {
            let display_metric = 0;
            let team_actual = 0;
            let team_scheduled = 0;

            if (reportId === 'absenteeism') {
                const totalScheduledRef = data?.globalScheduled || 1;
                display_metric = (team.absence_count / totalScheduledRef) * 100;
                team_actual = parseFloat(team.absence_count || 0); // Re-purposing actual column
                team_scheduled = parseFloat(team.unique_absentees || 0); // Re-purposing scheduled column
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

            return { ...team, display_metric, team_actual, team_scheduled };
        });
    }, [data, selectedTeams, reportId, mtdEmployeeData]);

    const handleToggleTeam = (team) => {
        const next = new Set(selectedTeams);
        if (next.has(team)) next.delete(team);
        else next.add(team);
        setSelectedTeams(next);
    };

    const handleSelectAllTeams = () => setSelectedTeams(new Set(availableTeams));
    const handleClearAllTeams = () => setSelectedTeams(new Set());

    const handleExportTeamCSV = () => {
        if (!filteredTeamStats.length) return;

        const headers = ['Team Name', reportId === 'run-rate' ? 'Team Run Rate (%)' : 'Avg. Productivity (%)', 'Actual Hours', 'Scheduled Hours', 'Start Date', 'End Date'];
        const rows = filteredTeamStats.map(team => [
            `"${team.group_name}"`,
            parseFloat(team.display_metric).toFixed(1),
            team.team_actual.toFixed(2),
            team.team_scheduled.toFixed(2),
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


    const getMetricColor = (val) => {
        const threshold = parseFloat(val || 0);
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
        if (statsSource.length === 0) return {
            productivity: 0, coverage: 0, punctuality: 0, 
            absenteeism_pct: 0, absenteeism_count: 0, lost_hours: 0,
            adherence: 0, overtime_pct: 0, total_hours: 0, 
            employees_tracked: 0, total_employees: 0, online_count: 0,
            scheduled_count: 0, late_count: 0, overtime_count: 0
        };

        const totals = statsSource.reduce((acc, team) => {
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
            acc.lost_hours += parseFloat(team.lost_hours || 0);
            
            return acc;
        }, {
            employee_count: 0, online_count: 0, offline_count: 0, 
            late_count: 0, scheduled_count: 0, total_productivity: 0, 
            total_adherence: 0, overtime_count: 0, low_adherence_count: 0,
            total_desktime: 0, tracked_count: 0, absence_count: 0, lost_hours: 0
        });

        return {
            productivity: totals.employee_count > 0 ? totals.total_productivity / totals.employee_count : 0,
            coverage: totals.scheduled_count > 0 ? (totals.online_count / totals.scheduled_count) * 100 : 0,
            punctuality: totals.scheduled_count > 0 ? (totals.late_count / totals.scheduled_count) * 100 : 0,
            absenteeism_pct: totals.scheduled_count > 0 ? (totals.absence_count / totals.scheduled_count) * 100 : 0,
            absenteeism_count: totals.absence_count,
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
    }, [filteredTeamStats, reportId]);

    const renderMetricCard = () => {
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
                sub = `${filteredTotals.absenteeism_count} No-Shows | ${filteredTotals.lost_hours} Hours Lost Capacity`;
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
                sub = `Actual Hours: ${runRateCalc.actual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs / Scheduled Hours: ${runRateCalc.adjusted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs`;
                break;
        }

        return (
            <div className="report-summary-card report-hero-card metric-card" onClick={() => setActiveDrillDown({ type: config.type, title: config.title, data: reportId === 'run-rate' ? mtdEmployeeData : undefined })}>
                <div className="hero-content">
                    <h2>{config.title}</h2>
                    <div className="hero-value" style={{ color: config.color }}>{val}</div>
                    <div className="hero-progress-bar">
                        <div className="fill" style={{ width: `${Math.min(progress, 100)}%`, background: getMetricColor(progress) }}></div>
                    </div>
                    {sub && <p className="hero-subtitle">{sub}</p>}
                </div>
            </div>
        );
    };

    if (loading) return <LoadingScreen loading={loading} message={`Preparing ${config.title}...`} />;
    if (error) return <div className="error-message">{error}</div>;

    return (
        <div className="stat-report-container">
            <div className="report-header">
                <button className="back-btn" onClick={onBack}>← Back</button>
                <h1>{config.title}</h1>
            </div>

            <div className="report-content">
                <div className="report-summary-grid">
                    {renderMetricCard()}
                </div>

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
                                        labelFormatter={(str) => new Date(str + 'T12:00:00').toLocaleDateString('en-US', { dateStyle: 'long' })}
                                    />
                                    <Area 
                                        type="monotone" 
                                        dataKey="count" 
                                        name="Absences"
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
                            <TeamFilter
                                teams={availableTeams}
                                selectedTeams={selectedTeams}
                                onToggle={handleToggleTeam}
                                onSelectAll={handleSelectAllTeams}
                                onClearAll={handleClearAllTeams}
                            />
                        </div>
                    </div>
                    <div className="report-table-wrapper">

                        <table className="report-table">
                            <thead>
                                <tr>
                                    <th>Team Name</th>
                                    <th>{reportId === 'absenteeism' ? 'Absence Rate' : reportId === 'run-rate' ? 'Team Run Rate' : 'Avg. Productivity'}</th>
                                    <th>{reportId === 'absenteeism' ? 'Total Absences' : 'Actual Hours'}</th>
                                    <th>{reportId === 'absenteeism' ? 'Unique Absentees' : 'Scheduled Hours'}</th>
                                    <th>Start Date</th>
                                    <th>End Date</th>
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
                                                <div className="mini-progress">
                                                        <div 
                                                            className="fill" 
                                                            style={{ 
                                                                width: `${Math.min(100, team.display_metric)}%`,
                                                                background: getMetricColor(team.display_metric)
                                                            }}
                                                        />
                                                </div>
                                            </div>
                                        </td>
                                        <td>{reportId === 'absenteeism' ? team.team_actual : team.team_actual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {reportId === 'absenteeism' ? '' : 'h'}</td>
                                        <td>{reportId === 'absenteeism' ? team.team_scheduled : team.team_scheduled.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {reportId === 'absenteeism' ? '' : 'h'}</td>
                                        <td>{formatDate(fromDate)}</td>
                                        <td>{formatDate(toDate)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
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
