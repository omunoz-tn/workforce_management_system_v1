import { useState, useEffect, useMemo } from 'react';
import './Dashboard.css';
import DrillDownModal from './DrillDownModal';
import LoadingScreen from './LoadingScreen';

const METRIC_INFO = {
    online: {
        desc: "Currently active employees connected to the system relative to those scheduled.",
        formula: "(Online Count / Scheduled Count) × 100"
    },
    productivity: {
        desc: "Ratio of productive time to total work time.",
        formula: "(Productive Time / Total Work Time) × 100"
    },
    late: {
        desc: "Employees arriving after the scheduled start time plus the defined threshold, relative to those scheduled.",
        formula: "(Late Arrivals / Scheduled Count) × 100"
    },
    topTeam: {
        desc: "The team with the highest average productivity score today, among teams with at least one member online.",
        formula: "MAX( AVG(productivity) ) GROUP BY group_name WHERE online_count > 0"
    },
    absenteeism: {
        desc: "Employees with a scheduled shift who never clocked in, relative to those scheduled.",
        formula: "(Absenteeism Count / Scheduled Count) × 100"
    },
    adherence: {
        desc: "How closely employees follow scheduled shifts.",
        formula: "(Actual Shift Time / Scheduled Shift Time) × 100"
    },
    overtime: {
        desc: "Hours worked beyond the standard shift duration.",
        formula: "Total Work Time - Scheduled Shift Duration"
    },
    teams: {
        desc: "Number of teams with at least one member currently online.",
        formula: "Count(Teams where Online Count > 0)"
    },
    totalHours: {
        desc: "Total DeskTime hours tracked across all employees today.",
        formula: "SUM(desktime_time) / 3600"
    },
    runRate: {
        desc: "Month-to-Date actual hours vs scheduled hours, with team lunch time deducted from scheduled.",
        formula: "(MTD Actual Hours / (MTD Scheduled Hours − Lunch Deduction Hours)) × 100"
    }
};

const InfoTooltip = ({ metricKey }) => {
    const info = METRIC_INFO[metricKey];
    if (!info) return null;
    return (
        <div className="info-tooltip-container" onClick={(e) => e.stopPropagation()}>
            <span className="info-icon-trigger">?</span>
            <div className="info-tooltip-content">
                <p className="info-desc">{info.desc}</p>
                <div className="info-formula">
                    <strong>Formula:</strong>
                    <code>{info.formula}</code>
                </div>
            </div>
        </div>
    );
};

const DEFAULT_PREFS = {
    visibleMetrics: ['online', 'productivity', 'late', 'topTeam', 'absenteeism', 'adherence', 'overtime', 'totalHours', 'runRate'],
    teamSource: 'hybrid',
    showGroupsSection: true,
    showUnassigned: true
};

const Dashboard = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [allEmployees, setAllEmployees] = useState([]);
    const [employeesServerTime, setEmployeesServerTime] = useState(null);
    const [activeDrillDown, setActiveDrillDown] = useState(null); // null, 'online', 'late'
    const [searchTerm, setSearchTerm] = useState('');

    const [lateThreshold, setLateThreshold] = useState(15);
    const [lateData, setLateData] = useState([]);
    const [syncing, setSyncing] = useState(false);
    const [chartFilter, setChartFilter] = useState('all'); // 'all', 'online', 'offline'
    const [preferences, setPreferences] = useState(DEFAULT_PREFS);
    const [isReorderMode, setIsReorderMode] = useState(false);
    const [draggedItem, setDraggedItem] = useState(null);
    const [billableFilter, setBillableFilter] = useState('billable'); // 'billable', 'all', 'non-billable'
    const [groupFilter, setGroupFilter] = useState('teams'); // 'groups', 'teams'

    useEffect(() => {
        const saved = localStorage.getItem('dashboard_preferences');
        if (saved) {
            const parsed = JSON.parse(saved);
            let mergedVisible = [...(parsed.visibleMetrics || [])];

            // VERSIONED MIGRATION: 
            // If user's preferences are old (version < 2), they don't have runRate.
            // We add it once, then the user can hide it.
            if (!parsed.version || parsed.version < 2) {
                if (!mergedVisible.includes('runRate')) {
                    mergedVisible.push('runRate');
                }
                parsed.version = 2;
                localStorage.setItem('dashboard_preferences', JSON.stringify({ ...parsed, visibleMetrics: mergedVisible }));
            }

            setPreferences({ ...DEFAULT_PREFS, ...parsed, visibleMetrics: mergedVisible });
        }
    }, []);

    const isLate = (arrived, shiftStart, threshold) => {
        if (!arrived || !shiftStart || shiftStart === '00:00:00') return false;

        // Convert to seconds since midnight for precision
        const timeToSeconds = (timeStr) => {
            const parts = timeStr.split(':').map(Number);
            const hours = parts[0] || 0;
            const minutes = parts[1] || 0;
            const seconds = parts[2] || 0;
            return hours * 3600 + minutes * 60 + seconds;
        };

        // Extract just the time if 'arrived' is a full datetime string (e.g., '2026-02-16 08:01:46')
        const arrivedTime = arrived.includes(' ') ? arrived.split(' ')[1] : arrived;
        return timeToSeconds(arrivedTime) > (timeToSeconds(shiftStart) + Number(threshold) * 60);
    };

    const fetchStats = async () => {
        try {
            const [statsRes, lateRes, employeesRes] = await Promise.all([
                fetch('./api/get_dashboard_stats.php'),
                fetch('./api/get_late_arrivals.php'),
                fetch('./api/get_online_employees.php?status=all')
            ]);

            const statsResult = await statsRes.json();
            const lateResult = await lateRes.json();
            const employeesResult = await employeesRes.json();

            if (statsResult.success) {
                setData(statsResult);
            } else {
                setError(statsResult.error);
            }

            if (lateResult.success) {
                setLateData(lateResult.data);
            }

            if (employeesResult.success) {
                setAllEmployees(employeesResult.data);
                setEmployeesServerTime(employeesResult.serverTime);
            }
        } catch (err) {
            setError('Failed to connect to the server');
        } finally {
            setLoading(false);
        }
    };

    const handleSync = async (isBackground = false) => {
        setSyncing(true);
        try {
            const res = await fetch('./api/sync_desktime.php');
            const result = await res.json();
            if (result.success) {
                await fetchStats();
                if (!isBackground) alert('Synchronization successful!');
            } else {
                if (!isBackground) alert('Sync failed: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            if (!isBackground) alert('Sync failed: Could not connect to the synchronization service');
        } finally {
            setSyncing(false);
        }
    };

    const toggleChartFilter = (filterType) => {
        setChartFilter(prev => prev === filterType ? 'all' : filterType);
    };

    useEffect(() => {
        fetchStats();
        // Auto-refresh stats every minute
        const statsInterval = setInterval(fetchStats, 60000);

        // Auto-synchronize with DeskTime every 5 minutes
        const syncInterval = setInterval(() => {
            console.log('Performing scheduled background sync...');
            handleSync(true); // Call sync with a flag to silent alerts
        }, 300000);

        return () => {
            clearInterval(statsInterval);
            clearInterval(syncInterval);
        };
    }, []);

    const { stats: orgStats, teamStats, statusBreakdown: orgStatusBreakdown, topTeam: orgTopTeam, mtdEmployeeData, lastUpdate } = data || {};

    const filteredAggregation = useMemo(() => {
        if (!data || !allEmployees.length) return null;

        const filteredTeams = teamStats.filter(team => {
            const matchesSearch = team.group_name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesChart = chartFilter === 'all' ||
                (chartFilter === 'online' && Number(team.online_count) > 0) ||
                (chartFilter === 'offline' && Number(team.online_count) === 0);

            const isUnassigned = team.group_name === 'Unassigned';
            const hideUnassigned = preferences.showUnassigned === false && isUnassigned;

            return matchesSearch && matchesChart && !hideUnassigned;
        });

        const effectiveEmployees = allEmployees.map(emp => {
            let effectiveTeam;
            if (groupFilter === 'groups') {
                effectiveTeam = emp.parent_group_name || 'Unassigned';
            } else {
                if (preferences.teamSource === 'desktime') {
                    effectiveTeam = emp.desktime_group || emp.group_name;
                } else if (preferences.teamSource === 'platform') {
                    effectiveTeam = emp.team_name || 'Unassigned';
                } else {
                    // Hybrid (Default)
                    effectiveTeam = emp.team_name || emp.desktime_group || emp.group_name;
                }
            }
            return { ...emp, effective_team: effectiveTeam };
        }).filter(emp => {
            if (billableFilter === 'all') return true;
            if (billableFilter === 'billable') return Number(emp.is_billable) === 1;
            if (billableFilter === 'non-billable') return Number(emp.is_billable) === 0;
            return true;
        });

        // Re-calculate team stats based on effective_team
        const teamMap = {};
        effectiveEmployees.forEach(emp => {
            const tName = emp.effective_team;
            if (!teamMap[tName]) {
                teamMap[tName] = { group_name: tName, employee_count: 0, online_count: 0, offline_count: 0, productivity_sum: 0, productive_count: 0 };
            }
            teamMap[tName].employee_count++;
            if (Number(emp.is_online) === 1) teamMap[tName].online_count++;
            else teamMap[tName].offline_count++;

            if (parseFloat(emp.productivity || 0) > 0) {
                teamMap[tName].productivity_sum += parseFloat(emp.productivity);
                teamMap[tName].productive_count++;
            }
        });

        const reCalculatedTeams = Object.values(teamMap).map(t => ({
            ...t,
            avg_productivity: t.productive_count > 0 ? t.productivity_sum / t.productive_count : 0
        })).filter(team => {
            const matchesSearch = team.group_name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesChart = chartFilter === 'all' ||
                (chartFilter === 'online' && Number(team.online_count) > 0) ||
                (chartFilter === 'offline' && Number(team.online_count) === 0);

            const isUnassigned = team.group_name === 'Unassigned';
            const hideUnassigned = preferences.showUnassigned === false && isUnassigned;

            return matchesSearch && matchesChart && !hideUnassigned;
        });

        const visibleTeamNames = new Set(reCalculatedTeams.map(t => t.group_name));
        const filteredEmployees = effectiveEmployees.filter(emp => visibleTeamNames.has(emp.effective_team));

        // Calculate filtered stats
        const total_employees = filteredEmployees.length;
        const scheduled_employees = filteredEmployees.filter(e => e.work_starts !== '00:00:00');
        const scheduled_count = scheduled_employees.length;
        const online_employees = filteredEmployees.filter(e => Number(e.is_online) === 1);
        const online_count = online_employees.length;
        const offline_count = total_employees - online_count;

        const productiveEmployees = filteredEmployees.filter(e => parseFloat(e.productivity || 0) > 0);
        const productivitySum = productiveEmployees.reduce((sum, e) => sum + parseFloat(e.productivity), 0);
        const avg_productivity = productiveEmployees.length > 0 ? (productivitySum / productiveEmployees.length) : 0;

        const current_late_count = filteredEmployees.filter(e => isLate(e.arrived, e.work_starts, lateThreshold)).length;

        // Calculate Filtered MTD Stats for Run Rate
        const filteredEmpIds = new Set(filteredEmployees.map(e => e.employee_id));
        const filteredMtd = (mtdEmployeeData || []).filter(mtd => filteredEmpIds.has(mtd.employee_id));

        const mtd_actual_hours = filteredMtd.reduce((sum, m) => sum + parseFloat(m.mtd_actual || 0), 0);
        const mtd_scheduled_hours = filteredMtd.reduce((sum, m) => sum + parseFloat(m.mtd_scheduled || 0), 0);
        const mtd_lunch_deduction = filteredMtd.reduce((sum, m) => sum + parseFloat(m.lunch_deduction_hours || 0), 0);
        const mtd_adjusted_scheduled = Math.max(mtd_scheduled_hours - mtd_lunch_deduction, 0);

        const absenteeism_count = filteredEmployees.filter(e =>
            Number(e.is_online) === 0 &&
            e.arrived === null &&
            e.work_starts !== '00:00:00' &&
            (employeesServerTime > e.work_starts)
        ).length;

        const timeToSec = (t) => {
            if (!t || t === '00:00:00') return 0;
            const [h, m, s] = t.split(':').map(Number);
            return h * 3600 + m * 60 + (s || 0);
        };
        // Extract HH:MM:SS from the lastUpdate ISO timestamp for live adherence
        const lastUpdateTimeSec = lastUpdate
            ? (() => {
                const d = new Date(lastUpdate);
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const ss = String(d.getSeconds()).padStart(2, '0');
                return timeToSec(`${hh}:${mm}:${ss}`);
            })()
            : 0;
        const adherenceEmployees = filteredEmployees.filter(e => {
            const startSec = timeToSec(e.work_starts);
            if (startSec === 0) return false;
            // Use lastUpdateTime as effective end, capped at work_ends if shift is over
            const scheduledEndSec = timeToSec(e.work_ends);
            const effectiveEndSec = scheduledEndSec > 0
                ? Math.min(lastUpdateTimeSec, scheduledEndSec)
                : lastUpdateTimeSec;
            const duration = effectiveEndSec - startSec;
            if (duration <= 0) return false;
            return (Number(e.at_work_time || 0) / duration) * 100 > 0;
        });
        const adherence_pct = adherenceEmployees.length > 0
            ? adherenceEmployees.reduce((sum, e) => {
                const startSec = timeToSec(e.work_starts);
                const scheduledEndSec = timeToSec(e.work_ends);
                const effectiveEndSec = scheduledEndSec > 0
                    ? Math.min(lastUpdateTimeSec, scheduledEndSec)
                    : lastUpdateTimeSec;
                return sum + Math.min((Number(e.at_work_time) / (effectiveEndSec - startSec)) * 100, 100);
            }, 0) / adherenceEmployees.length
            : 0;

        const out_of_adherence_count = adherenceEmployees.filter(e => {
            const startSec = timeToSec(e.work_starts);
            const scheduledEndSec = timeToSec(e.work_ends);
            const effectiveEndSec = scheduledEndSec > 0
                ? Math.min(lastUpdateTimeSec, scheduledEndSec)
                : lastUpdateTimeSec;
            const currentAdherence = Math.min((Number(e.at_work_time) / (effectiveEndSec - startSec)) * 100, 100);
            return currentAdherence < 90;
        }).length;

        const overtime_count = filteredEmployees.filter(e => parseFloat(e.after_work_time || 0) > 0).length;
        const overtime_pct = total_employees > 0 ? (overtime_count / total_employees) * 100 : 0;

        const total_hours = filteredEmployees.reduce((sum, e) => sum + (parseFloat(e.desktime_time || 0) / 3600), 0);
        const employees_tracked = filteredEmployees.filter(e => parseFloat(e.desktime_time || 0) > 0).length;

        const topTeamResult = [...filteredTeams]
            .filter(t => Number(t.online_count) > 0)
            .sort((a, b) => b.avg_productivity - a.avg_productivity)[0] || null;
        const filtered_late_data = filteredEmployees.filter(e => isLate(e.arrived, e.work_starts, lateThreshold));

        return {
            stats: {
                ...orgStats,
                total_employees,
                scheduled_count,
                online_count,
                offline_count,
                late_count: current_late_count,
                avg_productivity,
                absenteeism_count,
                adherence_pct,
                out_of_adherence_count,
                overtime_pct,
                total_hours,
                employees_tracked
            },
            topTeam: topTeamResult,
            statusBreakdown: {
                online: online_count,
                offline: offline_count
            },
            filteredTeams: reCalculatedTeams,
            filteredEmployees,
            filteredLateData: filtered_late_data,
            mtd_actual_hours,
            mtd_scheduled_hours,
            mtd_adjusted_scheduled,
            filteredMtd
        };
    }, [data, allEmployees, searchTerm, chartFilter, lateThreshold, employeesServerTime, orgStats, orgTopTeam, orgStatusBreakdown, teamStats, mtdEmployeeData, preferences.teamSource, billableFilter, groupFilter]);

    const stats = filteredAggregation?.stats || orgStats || {};
    const topTeam = filteredAggregation?.topTeam || orgTopTeam;
    const statusBreakdown = filteredAggregation?.statusBreakdown || orgStatusBreakdown || { online: 0, offline: 0 };
    const displayTeams = filteredAggregation?.filteredTeams || teamStats || [];
    const filteredEmployees = filteredAggregation?.filteredEmployees || allEmployees || [];
    const filteredLateData = filteredAggregation?.filteredLateData || [];

    const mtd_actual_hours = filteredAggregation?.mtd_actual_hours || 0;
    const mtd_scheduled_hours = filteredAggregation?.mtd_scheduled_hours || 0;
    const mtd_adjusted_scheduled = filteredAggregation?.mtd_adjusted_scheduled || 0;
    const filteredMtd = filteredAggregation?.filteredMtd || [];

    const currentLateCount = stats?.late_count || 0;
    const onlineTeamsCount = (displayTeams || []).filter(team => Number(team.online_count) > 0).length || 0;
    const offlineTeamsCount = (displayTeams || []).filter(team => Number(team.online_count) === 0).length || 0;

    const handleDragStart = (e, key) => {
        if (!isReorderMode) return;
        setDraggedItem(key);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
    };

    const handleDragEnter = (e, targetKey) => {
        if (!isReorderMode || !draggedItem || draggedItem === targetKey) return;
        e.preventDefault();
        const newMetrics = [...preferences.visibleMetrics];
        const draggedIndex = newMetrics.indexOf(draggedItem);
        const targetIndex = newMetrics.indexOf(targetKey);
        if (draggedIndex === -1 || targetIndex === -1) return;
        newMetrics.splice(draggedIndex, 1);
        newMetrics.splice(targetIndex, 0, draggedItem);
        
        setPreferences({ ...preferences, visibleMetrics: newMetrics });
    };

    const handleDragOver = (e) => {
        if (!isReorderMode) return;
        e.preventDefault();
    };

    const handleDragEnd = (e) => {
        if (!isReorderMode) return;
        e.preventDefault();
        setDraggedItem(null);
        
        const saved = localStorage.getItem('dashboard_preferences');
        if (saved) {
            const parsed = JSON.parse(saved);
            localStorage.setItem('dashboard_preferences', JSON.stringify({ ...parsed, visibleMetrics: preferences.visibleMetrics }));
        } else {
            localStorage.setItem('dashboard_preferences', JSON.stringify({ ...DEFAULT_PREFS, visibleMetrics: preferences.visibleMetrics }));
        }
    };

    const renderStatCard = (key) => {
        const dragClasses = isReorderMode ? 'reorder-mode' : '';
        const activeDragClass = draggedItem === key ? 'dragging' : '';
        const commonProps = {
            key: key,
            draggable: isReorderMode,
            onDragStart: (e) => handleDragStart(e, key),
            onDragEnter: (e) => handleDragEnter(e, key),
            onDragOver: handleDragOver,
            onDragEnd: handleDragEnd,
        };

        switch(key) {
            case 'online':
                return (
                    <div {...commonProps} className={`stat-card online clickable ${dragClasses} ${activeDragClass}`} onClick={() => !isReorderMode && setActiveDrillDown({ type: 'online', title: 'Employee Status Details' })}>
                        <InfoTooltip metricKey="online" />
                        <div className="stat-icon">🎯</div>
                        <div className="stat-content">
                            <h3>Coverage</h3>
                            <p className="stat-value">{stats.scheduled_count > 0 ? ((stats.online_count / stats.scheduled_count) * 100).toFixed(1) : '0.0'}%</p>
                            <div className="progress-bar"><div className="progress-fill" style={{ width: `${stats.scheduled_count > 0 ? (stats.online_count / stats.scheduled_count) * 100 : 0}%` }}></div></div>
                            <p className="stat-subtitle">{stats.online_count} / {stats.scheduled_count} Employees</p>
                        </div>
                    </div>
                );
            case 'productivity':
                return (
                    <div {...commonProps} className={`stat-card productivity clickable ${dragClasses} ${activeDragClass}`} onClick={() => !isReorderMode && setActiveDrillDown({ type: 'productivity', title: 'Productivity Details' })}>
                        <InfoTooltip metricKey="productivity" />
                        <div className="stat-icon">⚡</div>
                        <div className="stat-content">
                            <h3>Avg. Productivity</h3>
                            <p className="stat-value">{parseFloat(stats.avg_productivity).toFixed(1)}%</p>
                            <div className="progress-bar"><div className="progress-fill" style={{ width: `${stats.avg_productivity}%` }}></div></div>
                        </div>
                    </div>
                );
            case 'late':
                return (
                    <div {...commonProps} className={`stat-card punctuality clickable ${dragClasses} ${activeDragClass}`} onClick={() => !isReorderMode && setActiveDrillDown({ type: 'late', title: `Late Arrivals (${lateThreshold} Mins)`, threshold: lateThreshold })}>
                        <InfoTooltip metricKey="late" />
                        <div className="stat-icon">⏰</div>
                        <div className="stat-content">
                            <h3 className="late-header">
                                LATE ARRIVALS (
                                <input type="text" className="threshold-input" value={lateThreshold} onClick={(e) => e.stopPropagation()} onChange={(e) => setLateThreshold(e.target.value.replace(/\D/g, ''))} />
                                MINS)
                            </h3>
                            <p className="stat-value">{stats.scheduled_count > 0 ? ((currentLateCount / stats.scheduled_count) * 100).toFixed(1) : '0.0'}%</p>
                            <div className="progress-bar"><div className="progress-fill" style={{ width: `${stats.scheduled_count > 0 ? (currentLateCount / stats.scheduled_count) * 100 : 0}%`, background: '#e53e3e' }}></div></div>
                            <p className="stat-subtitle">{currentLateCount} / {stats.scheduled_count} Late Arrivals</p>
                        </div>
                    </div>
                );
            case 'topTeam':
                return (
                    <div {...commonProps} className={`stat-card top-team clickable ${dragClasses} ${activeDragClass}`} onClick={() => !isReorderMode && setActiveDrillDown({ type: 'topTeam', title: 'Team Productivity Ranking' })}>
                        <InfoTooltip metricKey="topTeam" />
                        <div className="stat-icon">🏆</div>
                        <div className="stat-content">
                            <h3>Top Productive Team</h3>
                            {topTeam ? (
                                <>
                                    <p style={{ fontSize: '1.1rem', fontWeight: 'bold', margin: '2px 0', color: '#1a202c' }}>{topTeam.group_name}</p>
                                    <p className="stat-value" style={{ margin: '0' }}>{parseFloat(topTeam.avg_productivity).toFixed(1)}%</p>
                                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${topTeam.avg_productivity}%`, background: '#d69e2e' }}></div></div>
                                </>
                            ) : (<p className="stat-subtitle">No data yet</p>)}
                        </div>
                    </div>
                );
            case 'absenteeism':
                return (
                    <div {...commonProps} className={`stat-card absenteeism clickable ${dragClasses} ${activeDragClass}`} onClick={() => !isReorderMode && setActiveDrillDown({ type: 'absenteeism', title: 'Absenteeism Details' })}>
                        <InfoTooltip metricKey="absenteeism" />
                        <div className="stat-icon">📉</div>
                        <div className="stat-content">
                            <h3>Absenteeism</h3>
                            <p className="stat-value">{stats.scheduled_count > 0 ? ((stats.absenteeism_count / stats.scheduled_count) * 100).toFixed(1) : '0.0'}%</p>
                            <div className="progress-bar"><div className="progress-fill" style={{ width: `${stats.scheduled_count > 0 ? (stats.absenteeism_count / stats.scheduled_count) * 100 : 0}%`, background: '#e53e3e' }}></div></div>
                            <p className="stat-subtitle">{stats.absenteeism_count} / {stats.scheduled_count} No-Shows</p>
                        </div>
                    </div>
                );
            case 'adherence':
                return (
                    <div {...commonProps} className={`stat-card adherence clickable ${dragClasses} ${activeDragClass}`} onClick={() => !isReorderMode && setActiveDrillDown({ type: 'adherence', title: 'Adherence Details' })}>
                        <InfoTooltip metricKey="adherence" />
                        <div className="stat-icon">✅</div>
                        <div className="stat-content">
                            <h3>Adherence</h3>
                            <p className="stat-value">{parseFloat(stats.adherence_pct || 0).toFixed(1)}%</p>
                            <div className="progress-bar"><div className="progress-fill" style={{ width: `${stats.adherence_pct || 0}%`, background: '#38a169' }}></div></div>
                            <p className="stat-subtitle">{stats.out_of_adherence_count} Out of Adherence (&lt; 90%)</p>
                        </div>
                    </div>
                );
            case 'overtime':
                return (
                    <div {...commonProps} className={`stat-card overtime clickable ${dragClasses} ${activeDragClass}`} onClick={() => !isReorderMode && setActiveDrillDown({ type: 'overtime', title: 'Overtime Details' })}>
                        <InfoTooltip metricKey="overtime" />
                        <div className="stat-icon">🕒</div>
                        <div className="stat-content">
                            <h3>Overtime</h3>
                            <p className="stat-value">{parseFloat(stats.overtime_pct).toFixed(1)}%</p>
                            <div className="progress-bar"><div className="progress-fill" style={{ width: `${stats.overtime_pct}%`, background: '#805ad5' }}></div></div>
                        </div>
                    </div>
                );
            case 'totalHours':
                return (
                    <div {...commonProps} className={`stat-card total-hours clickable ${dragClasses} ${activeDragClass}`} onClick={() => !isReorderMode && setActiveDrillDown({ type: 'totalHours', title: 'Total Hours Tracked' })}>
                        <InfoTooltip metricKey="totalHours" />
                        <div className="stat-icon">🕐</div>
                        <div className="stat-content">
                            <h3>Total Hours Tracked</h3>
                            <p className="stat-value">{parseFloat(stats.total_hours || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min((stats.employees_tracked / stats.total_employees) * 100, 100)}%`, background: '#3182ce' }}></div></div>
                        </div>
                    </div>
                );
            case 'runRate':
                return (
                    <div {...commonProps} className={`stat-card run-rate clickable ${dragClasses} ${activeDragClass}`} onClick={() => !isReorderMode && setActiveDrillDown({ type: 'runRate', title: 'Run Rate Details (Month-to-Date)', data: filteredMtd })}>
                        <InfoTooltip metricKey="runRate" />
                        <div className="stat-icon">📈</div>
                        <div className="stat-content">
                            <div className="stat-header-main"><h3>Run Rate</h3></div>
                            <div className="run-rate-value-container">
                                <div className="stat-value">{mtd_adjusted_scheduled > 0 ? `${Math.round((mtd_actual_hours / mtd_adjusted_scheduled) * 100)}%` : '0%'}</div>
                                {mtd_adjusted_scheduled > mtd_actual_hours && (
                                    <div className="run-rate-missing-container" title="Missing hours to reach schedule (after lunch deduction)">
                                        <div className="run-rate-missing-value">-{Number(mtd_adjusted_scheduled - mtd_actual_hours).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}h</div>
                                        <div className="run-rate-missing-label">missing hours</div>
                                    </div>
                                )}
                            </div>
                            <div className="progress-bar"><div className="progress-fill run-rate-fill" style={{ width: `${Math.min((mtd_actual_hours / (mtd_adjusted_scheduled || 1)) * 100, 100)}%` }}></div></div>
                            <p className="stat-subtitle">MTD: {Number(mtd_actual_hours || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs</p>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="dashboard-container">
            <LoadingScreen loading={loading} message="Loading Dashboard" />

            {error && <div className="dashboard-error">Error: {error}</div>}

            {data && (
                <>
                    <header className="dashboard-header">
                        <h1>{searchTerm.trim() ? (displayTeams.length === 1 ? displayTeams[0].group_name : searchTerm) : 'All Teams'}</h1>
                        <div className="header-controls">
                            <button 
                                className={`reorder-toggle-btn ${isReorderMode ? 'active' : ''}`}
                                onClick={() => setIsReorderMode(!isReorderMode)}
                                data-tooltip="Sort Cards"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                                  <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />
                                </svg>
                            </button>
                            <p className="last-update">Last Updated: {new Date(lastUpdate).toLocaleString()}</p>
                        </div>
                    </header>

                    <div className="stats-grid">
                        {preferences.visibleMetrics.map(key => renderStatCard(key))}
                    </div>

                    {preferences.showGroupsSection && (
                        <div className="dashboard-sections">
                            <section className="team-performance">
                                <div className="section-header">
                                    <h2>{groupFilter === 'groups' ? 'Online Groups' : 'Online Teams'}</h2>
                                    <div className="filter-controls-group">
                                        <div className="billable-toggle-segmented">
                                            <button 
                                                className={`toggle-option ${groupFilter === 'groups' ? 'active' : ''}`}
                                                onClick={() => setGroupFilter('groups')}
                                            >
                                                Groups
                                            </button>
                                            <button 
                                                className={`toggle-option ${groupFilter === 'teams' ? 'active' : ''}`}
                                                onClick={() => setGroupFilter('teams')}
                                            >
                                                Teams
                                            </button>
                                        </div>
                                        <div className="billable-toggle-segmented">
                                            <button 
                                                className={`toggle-option ${billableFilter === 'billable' ? 'active' : ''}`}
                                                onClick={() => setBillableFilter('billable')}
                                            >
                                                Billable
                                            </button>
                                            <button 
                                                className={`toggle-option ${billableFilter === 'all' ? 'active' : ''}`}
                                                onClick={() => setBillableFilter('all')}
                                            >
                                                All
                                            </button>
                                            <button 
                                                className={`toggle-option ${billableFilter === 'non-billable' ? 'active' : ''}`}
                                                onClick={() => setBillableFilter('non-billable')}
                                            >
                                                Non-Billable
                                            </button>
                                        </div>
                                        <div className="search-filter">
                                            <input
                                                type="text"
                                                placeholder="Filter teams..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="breakdown-chart mini">
                                    <div
                                        className={`chart-item online ${chartFilter === 'online' ? 'active' : ''}`}
                                        style={{ flex: statusBreakdown.online }}
                                        onClick={() => toggleChartFilter('online')}
                                        title={`${statusBreakdown.online} Employees Online (${onlineTeamsCount} Teams)`}
                                    >
                                        <span>Online {((Number(statusBreakdown.online) / (Number(statusBreakdown.online) + Number(statusBreakdown.offline))) * 100).toFixed(0)}%</span>
                                    </div>
                                    <div
                                        className={`chart-item offline ${chartFilter === 'offline' ? 'active' : ''}`}
                                        style={{ flex: statusBreakdown.offline }}
                                        onClick={() => toggleChartFilter('offline')}
                                        title={`${statusBreakdown.offline} Employees Offline (${offlineTeamsCount} Teams)`}
                                    >
                                        <span>Offline {((Number(statusBreakdown.offline) / (Number(statusBreakdown.online) + Number(statusBreakdown.offline))) * 100).toFixed(0)}%</span>
                                    </div>
                                </div>

                                <div className="team-list">
                                    {displayTeams.map((team, index) => (
                                        <div
                                            key={index}
                                            className={`team-item clickable ${Number(team.online_count) === 0 ? 'offline-team' : ''}`}
                                            onClick={() => setActiveDrillDown({
                                                type: 'online',
                                                title: `Team Status: ${team.group_name}`,
                                                team: team.group_name
                                            })}
                                        >
                                            <div className="team-info">
                                                <span className="team-name">{team.group_name}</span>
                                                <div className="team-meta">
                                                    <span className="team-count">{team.employee_count} Members</span>
                                                    <span className="online-pct">
                                                        Online: {((Number(team.online_count) / Number(team.employee_count)) * 100).toFixed(0)}%
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    )}

                    {activeDrillDown && (
                        <DrillDownModal
                            type={activeDrillDown.type}
                            title={activeDrillDown.title}
                            team={activeDrillDown.team}
                            fromDate={(() => {
                                const d = new Date();
                                d.setDate(1);
                                return d.toISOString().split('T')[0];
                            })()}
                            toDate={new Date().toISOString().split('T')[0]}
                            threshold={lateThreshold}
                            initialData={
                                activeDrillDown.type === 'late' ? filteredLateData :
                                    (activeDrillDown.type === 'teams' || activeDrillDown.type === 'topTeam') ? displayTeams :
                                        activeDrillDown.type === 'runRate' ? filteredMtd :
                                            filteredEmployees
                            }
                            serverTime={employeesServerTime}
                            onClose={() => setActiveDrillDown(null)}
                        />
                    )}
                </>
            )}
        </div>
    );
};

export default Dashboard;
