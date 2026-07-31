import React, { useState, useEffect, useMemo } from 'react';
import './Infograph.css';
import DateRangeModal from './DateRangeModal';
import { 
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell
} from 'recharts';

const Infograph = () => {
    // Default to Month-to-Date
    const getMtdRange = () => {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };
        return { from: formatDate(firstDay), to: formatDate(now) };
    };

    const initialDates = getMtdRange();
    const [fromDate, setFromDate] = useState(initialDates.from);
    const [toDate, setToDate] = useState(initialDates.to);
    const [isModalOpen, setIsModalOpen] = useState(false);
    
    const [loading, setLoading] = useState(true);
    const [dashData, setDashData] = useState(null);
    const [absData, setAbsData] = useState(null);
    const [error, setError] = useState(null);

    const fetchData = async (from, to) => {
        setLoading(true);
        setError(null);
        try {
            const [dashRes, absRes] = await Promise.all([
                fetch(`./api/get_dashboard_stats.php?from=${from}&to=${to}`),
                fetch(`./api/get_absenteeism_details.php?from=${from}&to=${to}`)
            ]);
            
            const dashResult = await dashRes.json();
            const absResult = await absRes.json();

            if (dashResult.success && absResult.success) {
                setDashData(dashResult);
                setAbsData(absResult);
            } else {
                setError(dashResult.error || absResult.error || "Failed to load data.");
            }
        } catch (err) {
            setError("Network error while fetching data.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData(fromDate, toDate);
    }, [fromDate, toDate]);

    const handleDateConfirm = (newFrom, newTo) => {
        setFromDate(newFrom);
        setToDate(newTo);
        setIsModalOpen(false);
    };

    const formatDateStr = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // Calculate aggregated totals based on team stats logic
    const totals = useMemo(() => {
        if (!dashData || !absData) return {};
        
        const dTeams = dashData.teamStats || [];
        const aTeams = absData.teamStats || [];
        const mtdData = dashData.mtdEmployeeData || [];

        let empCount = 0, onlineCount = 0, offlineCount = 0;
        let lateCount = 0, schedCount = 0, totProd = 0, totAdh = 0;
        let otCount = 0, totDesktime = 0, trackedCount = 0;
        let absCount = 0, uniqueAbs = 0, lostHours = 0, absSchedCount = 0;

        dTeams.forEach(t => {
            const eCount = Number(t.employee_count || 0);
            empCount += eCount;
            onlineCount += Number(t.online_count || 0);
            offlineCount += Number(t.offline_count || 0);
            lateCount += Number(t.late_count || 0);
            schedCount += Number(t.scheduled_count || t.total_scheduled || 0);
            totProd += (parseFloat(t.avg_productivity || 0) * (eCount || 1));
            totAdh += (parseFloat(t.avg_adherence || 0) * (eCount || 1));
            otCount += Number(t.overtime_count || 0);
            totDesktime += parseFloat(t.total_desktime || t.desktime_time || 0);
            trackedCount += Number(t.tracked_count || eCount || 0);
        });

        aTeams.forEach(t => {
            absCount += Number(t.absence_count || 0);
            uniqueAbs += Number(t.unique_absentees || 0);
            lostHours += parseFloat(t.lost_hours || 0);
            absSchedCount += Number(t.total_scheduled || 0);
        });

        const prod = empCount > 0 ? totProd / empCount : 0;
        const cov = schedCount > 0 ? (onlineCount / schedCount) * 100 : 0;
        const punc = schedCount > 0 ? (lateCount / schedCount) * 100 : 0;
        const absPct = absSchedCount > 0 ? (absCount / absSchedCount) * 100 : 0;
        const adh = empCount > 0 ? totAdh / empCount : 0;
        const otPct = empCount > 0 ? (otCount / empCount) * 100 : 0;
        const hours = totDesktime / 3600;

        // Run rate MTD logic
        const rrActual = mtdData.reduce((s, m) => s + parseFloat(m.mtd_actual || 0), 0);
        const rrSched = mtdData.reduce((s, m) => s + parseFloat(m.mtd_scheduled || 0), 0);
        const rrLunch = mtdData.reduce((s, m) => s + parseFloat(m.lunch_deduction_hours || 0), 0);
        const rrAdj = Math.max(rrSched - rrLunch, 0);
        const rrPct = rrAdj > 0 ? (rrActual / rrAdj) * 100 : 0;

        return {
            productivity: prod, coverage: cov, punctuality: punc,
            absenteeism_pct: absPct, absenteeism_count: absCount, 
            unique_absentees: uniqueAbs, lost_hours: lostHours.toFixed(1),
            adherence: adh, overtime_pct: otPct, total_hours: hours,
            run_rate_pct: rrPct, run_rate_actual: rrActual, run_rate_sched: rrAdj
        };
    }, [dashData, absData]);

    const teamRankings = useMemo(() => {
        if (!dashData) return { topProductivity: [] };
        let teams = [...(dashData.teamStats || [])].map(t => ({
            name: t.group_name,
            val: parseFloat(t.avg_productivity || 0)
        }));
        teams.sort((a, b) => b.val - a.val);
        return { topProductivity: teams.slice(0, 5) };
    }, [dashData]);

    const teamHeatmapData = useMemo(() => {
        if (!dashData) return [];
        let teams = [...(dashData.teamStats || [])].map(t => ({
            name: t.group_name,
            Productivity: parseFloat(t.avg_productivity || 0)
        }));
        return teams.sort((a, b) => b.Productivity - a.Productivity);
    }, [dashData]);

    const getMetricColor = (val, invert = false) => {
        if (invert) {
            if (val <= 3) return 'bg-green';
            if (val <= 7) return 'bg-blue';
            if (val <= 12) return 'bg-yellow';
            return 'bg-red';
        }
        if (val < 70) return 'bg-red';
        if (val < 85) return 'bg-yellow';
        if (val < 95) return 'bg-blue';
        return 'bg-green';
    };

    const getMetricColorValue = (val, invert = false) => {
        if (invert) {
            if (val <= 3) return '#10b981';
            if (val <= 7) return '#3b82f6';
            if (val <= 12) return '#f59e0b';
            return '#ef4444';
        }
        if (val < 70) return '#ef4444';
        if (val < 85) return '#f59e0b';
        if (val < 95) return '#3b82f6';
        return '#10b981';
    };

    const KPICard = ({ title, icon, value, subtext, progress, invertColor = false }) => (
        <div className="ig-kpi-card">
            <div className="ig-kpi-header">
                <h3 className="ig-kpi-title">{title}</h3>
                <div className={`ig-kpi-icon ${getMetricColor(progress, invertColor).replace('bg-', 'color-')} bg-opacity-10`}>
                    {icon}
                </div>
            </div>
            <div>
                <div className="ig-kpi-value-container">
                    <span className="ig-kpi-value">{value}</span>
                </div>
                <div className="ig-kpi-subtext">{subtext}</div>
            </div>
            {progress !== undefined && (
                <div className="ig-progress-container">
                    <div 
                        className={`ig-progress-fill ${getMetricColor(progress, invertColor)}`} 
                        style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
                    />
                </div>
            )}
        </div>
    );

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner-large" style={{marginBottom: '20px'}}></div>
                <h2>Generating Infograph...</h2>
            </div>
        );
    }

    if (error) {
        return <div className="infograph-container"><div className="error-message">{error}</div></div>;
    }

    return (
        <div className="infograph-container">
            <div className="infograph-header">
                <h1>Workforce Infograph</h1>
                <div className="infograph-controls">
                    <span className="date-display">{formatDateStr(fromDate)} - {formatDateStr(toDate)}</span>
                    <button className="quick-select-btn" onClick={() => setIsModalOpen(true)}>
                        📅 Quick Select ▼
                    </button>
                </div>
            </div>

            <div className="ig-grid-4x2">
                <KPICard 
                    title="Coverage" icon="🎯" 
                    value={`${totals.coverage.toFixed(1)}%`} 
                    subtext="Online vs Scheduled"
                    progress={totals.coverage} 
                />
                <KPICard 
                    title="Productivity" icon="⚡" 
                    value={`${totals.productivity.toFixed(1)}%`} 
                    subtext="Average Team Productivity"
                    progress={totals.productivity} 
                />
                <KPICard 
                    title="Absenteeism" icon="📉" 
                    value={`${totals.absenteeism_pct.toFixed(1)}%`} 
                    subtext={`${totals.absenteeism_count} No-Shows (${totals.lost_hours}h lost)`}
                    progress={totals.absenteeism_pct} 
                    invertColor={true}
                />
                <KPICard 
                    title="Adherence" icon="✅" 
                    value={`${totals.adherence.toFixed(1)}%`} 
                    subtext="Average Schedule Adherence"
                    progress={totals.adherence} 
                />
                <KPICard 
                    title="Punctuality" icon="⏰" 
                    value={`${totals.punctuality.toFixed(1)}%`} 
                    subtext="Late Arrival Rate"
                    progress={totals.punctuality} 
                    invertColor={true}
                />
                <KPICard 
                    title="Run Rate" icon="📈" 
                    value={`${totals.run_rate_pct.toFixed(1)}%`} 
                    subtext={`${totals.run_rate_actual.toFixed(0)}h / ${totals.run_rate_sched.toFixed(0)}h`}
                    progress={totals.run_rate_pct} 
                />
                <KPICard 
                    title="Overtime" icon="🕒" 
                    value={`${totals.overtime_pct.toFixed(1)}%`} 
                    subtext="Overtime Incidence Rate"
                    progress={totals.overtime_pct} 
                    invertColor={true}
                />
                <KPICard 
                    title="Total Hours" icon="🕐" 
                    value={totals.total_hours.toLocaleString('en-US', {maximumFractionDigits: 0})} 
                    subtext="Tracked Productive Hours"
                    progress={100} 
                />
            </div>

            <div className="ig-charts-row">
                <div className="ig-chart-card">
                    <div className="ig-chart-header">
                        <h3 className="ig-chart-title">Daily Absence Trend</h3>
                    </div>
                    <div className="ig-chart-body">
                        {absData?.trend && absData.trend.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={absData.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorAbs" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.2)" />
                                    <XAxis 
                                        dataKey="log_date" 
                                        tick={{fill: '#718096', fontSize: 12}} 
                                        tickFormatter={(str) => new Date(str + 'T12:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                                        axisLine={false} tickLine={false}
                                    />
                                    <YAxis tick={{fill: '#718096', fontSize: 12}} axisLine={false} tickLine={false} />
                                    <Tooltip 
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                                        labelFormatter={(l) => new Date(l + 'T12:00:00').toLocaleDateString('en-US', { dateStyle: 'long' })}
                                    />
                                    <Area type="monotone" dataKey="absence_count" name="No-Shows" stroke="#ef4444" strokeWidth={3} fillOpacity={1} fill="url(#colorAbs)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div style={{display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#718096'}}>
                                No trend data available for this period.
                            </div>
                        )}
                    </div>
                </div>

                <div className="ig-chart-card">
                    <div className="ig-chart-header">
                        <h3 className="ig-chart-title">🏆 Top Teams (Productivity)</h3>
                    </div>
                    <div className="ig-ranking-list">
                        {teamRankings.topProductivity.map((t, i) => (
                            <div key={i} className="ig-ranking-item">
                                <div className="ig-rank-number">#{i + 1}</div>
                                <div className="ig-rank-team">{t.name}</div>
                                <div className="ig-rank-value" style={{color: getMetricColorValue(t.val)}}>{t.val.toFixed(1)}%</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="ig-full-width-chart">
                <div className="ig-chart-header">
                    <h3 className="ig-chart-title">Team Performance Heatmap</h3>
                </div>
                <div style={{ height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={teamHeatmapData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.2)" />
                            <XAxis 
                                dataKey="name" 
                                tick={{fill: '#718096', fontSize: 11}} 
                                angle={-45} 
                                textAnchor="end"
                                interval={0}
                                height={60}
                            />
                            <YAxis tick={{fill: '#718096', fontSize: 12}} />
                            <Tooltip 
                                cursor={{fill: 'rgba(128,128,128,0.1)'}}
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                            />
                            <Bar dataKey="Productivity" radius={[4, 4, 0, 0]}>
                                {teamHeatmapData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={getMetricColorValue(entry.Productivity)} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="ig-footer">
                Generated on {new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} • Executive Summary
            </div>

            <DateRangeModal 
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onConfirm={handleDateConfirm}
            />
        </div>
    );
};

export default Infograph;
