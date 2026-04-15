import { useState, useEffect } from 'react';
import './DrillDownModal.css';
import DailyDetailsModal from './DailyDetailsModal';

const DrillDownModal = ({ type, title, team, onClose, threshold, initialData, serverTime: propServerTime, fromDate, toDate }) => {
    const [data, setData] = useState(initialData || []);
    const [loading, setLoading] = useState(!initialData);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('all');
    const [modalSearchTerm, setModalSearchTerm] = useState('');
    const [serverTime, setServerTime] = useState(propServerTime || null);
    const [showDailyDetails, setShowDailyDetails] = useState(false);

    // Default MTD range for the daily modal (matching backend logic) if not provided as props
    const getMtdRange = () => {
        const mtdFrom = new Date();
        mtdFrom.setDate(1);
        return {
            from: mtdFrom.toISOString().split('T')[0],
            to: new Date().toISOString().split('T')[0]
        };
    };

    const range = getMtdRange();
    const fromDateStr = fromDate || range.from;
    const toDateStr = toDate || range.to;

    const timeToSeconds = (timeStr) => {
        if (!timeStr || timeStr === '00:00:00') return 0;
        const parts = timeStr.split(':').map(Number);
        const hours = parts[0] || 0;
        const minutes = parts[1] || 0;
        const seconds = parts[2] || 0;
        return hours * 3600 + minutes * 60 + seconds;
    };

    const isLate = (arrived, shiftStart, thresholdValue) => {
        if (!arrived || !shiftStart || shiftStart === '00:00:00') return false;
        // Extract just the time if 'arrived' is a full datetime string
        const arrivedTime = arrived.includes(' ') ? arrived.split(' ')[1] : arrived;
        return timeToSeconds(arrivedTime) > (timeToSeconds(shiftStart) + Number(thresholdValue) * 60);
    };

    const calculateAdherence = (item, effectiveEndStr) => {
        if (!item.work_starts || item.work_starts === '00:00:00') return 0;
        const startSec = timeToSeconds(item.work_starts);
        if (startSec === 0) return 0;

        // Use effectiveEndStr (serverTime / now) if provided, capped at work_ends
        const scheduledEndSec = timeToSeconds(item.work_ends);
        let endSec;
        if (effectiveEndStr) {
            const effectiveSec = timeToSeconds(effectiveEndStr);
            endSec = scheduledEndSec > 0 ? Math.min(effectiveSec, scheduledEndSec) : effectiveSec;
        } else {
            endSec = scheduledEndSec;
        }

        const scheduledDuration = endSec - startSec;
        if (scheduledDuration <= 0) return 0;

        // Adherence = (Actually Spent At Work / Effective Shift Duration) * 100
        const adherence = (Number(item.at_work_time || 0) / scheduledDuration) * 100;
        return Math.min(adherence, 100);
    };

    useEffect(() => {
        if (initialData) {
            setData(initialData);
            setLoading(false);
            if (propServerTime) setServerTime(propServerTime);
            return;
        }

        const fetchData = async () => {
            setLoading(true);
            try {
                let url = '';
                if (type === 'online' || type === 'productivity' || type === 'efficiency' || type === 'absenteeism' || type === 'adherence' || type === 'overtime' || type === 'totalHours') {
                    url = `./api/get_online_employees.php?status=all${type === 'absenteeism' ? '&type=absenteeism' : ''}${team ? `&team=${encodeURIComponent(team)}` : ''}&from=${fromDateStr}&to=${toDateStr}`;
                } else if (type === 'late') {
                    url = `./api/get_late_arrivals.php`;
                } else if (type === 'teams' || type === 'topTeam') {
                    url = `./api/get_dashboard_stats.php`;
                } else if (type === 'runRate') {
                    // runRate uses initialData passed from Dashboard
                    url = '';
                }

                const response = await fetch(url);
                const result = await response.json();
                if (result.success) {
                    if (type === 'teams' || type === 'topTeam') {
                        setData(result.teamStats || []);
                    } else {
                        setData(result.data);
                        if (result.serverTime) setServerTime(result.serverTime);
                    }
                } else {
                    setError(result.error);
                }
            } catch (err) {
                setError('Failed to fetch data');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [type, team, initialData, propServerTime]);

    // Apply filtering and sorting in frontend
    let displayData = data.filter(item => {
        // If we have team prop and we're using initialData, filter by team first
        if (team && initialData && type !== 'teams' && type !== 'topTeam') {
            if (item.group_name !== team && item.team_name !== team) return false;
        }
        return true;
    }).filter(item => {
        const term = modalSearchTerm.toLowerCase();
        return (item.name || "").toLowerCase().includes(term) ||
            (item.group_name || item.team_name || "").toLowerCase().includes(term);
    }).filter(item => {
        if (type === 'absenteeism') {
            // Use only the server's MySQL time — never fall back to browser time (timezone mismatch)
            if (!serverTime) return false;
            const shiftStart = item.work_starts;
            if (!shiftStart || shiftStart === '00:00:00') return false;
            return item.is_online == 0 && item.arrived === null && serverTime > shiftStart;
        }

        if (type === 'late') {
            return isLate(item.arrived, item.work_starts, threshold);
        }

        if (type === 'adherence') {
            return item.is_online == 1;
        }
        if (type === 'overtime') {
            return item.after_work_time > 0;
        }
        if (type === 'totalHours') {
            if (filter === 'online') return item.is_online == 1;
            if (filter === 'offline') return item.is_online == 0;
            return true;
        }
        if (type === 'online') {
            if (filter === 'online') return item.is_online == 1;
            if (filter === 'offline') return item.is_online == 0;
        }
        if (type === 'topTeam') {
            if (filter === 'online') return Number(item.online_count) > 0;
        }
        return true;
    });

    // Aggregation logic for Teams view in totalHours modal
    if (type === 'totalHours' && filter === 'teams_view') {
        const teamsMap = {};
        displayData.forEach(item => {
            const teamName = item.group_name || 'Unassigned';
            if (!teamsMap[teamName]) {
                teamsMap[teamName] = {
                    group_name: teamName,
                    desktime_time: 0,
                    employee_count: 0
                };
            }
            teamsMap[teamName].desktime_time += Number(item.desktime_time || 0);
            teamsMap[teamName].employee_count += 1;
        });
        displayData = Object.values(teamsMap);
    }

    // Sorting
    if (type === 'productivity') {
        displayData.sort((a, b) => b.productivity - a.productivity);
    } else if (type === 'efficiency') {
        displayData.sort((a, b) => b.efficiency - a.efficiency);
    } else if (type === 'overtime') {
        displayData.sort((a, b) => b.after_work_time - a.after_work_time);
    } else if (type === 'topTeam') {
        displayData.sort((a, b) => b.avg_productivity - a.avg_productivity);
    } else if (type === 'totalHours') {
        displayData.sort((a, b) => b.desktime_time - a.desktime_time);
    } else if (type === 'adherence') {
        displayData.sort((a, b) => calculateAdherence(b, serverTime) - calculateAdherence(a, serverTime));
    } else if (type === 'online') {
        displayData.sort((a, b) => b.is_online - a.is_online);
    } else if (type === 'late') {
        displayData.sort((a, b) => {
            const delayA = Math.max(0, timeToSeconds(a.arrived) - timeToSeconds(a.work_starts));
            const delayB = Math.max(0, timeToSeconds(b.arrived) - timeToSeconds(b.work_starts));
            return delayB - delayA;
        });
    } else if (type === 'runRate') {
        displayData.sort((a, b) => {
            const adjA = Math.max(parseFloat(a.mtd_scheduled || 0) - parseFloat(a.lunch_deduction_hours || 0), 0);
            const adjB = Math.max(parseFloat(b.mtd_scheduled || 0) - parseFloat(b.lunch_deduction_hours || 0), 0);
            const rateA = adjA > 0 ? (a.mtd_actual / adjA) : 0;
            const rateB = adjB > 0 ? (b.mtd_actual / adjB) : 0;
            return rateA - rateB; // Sort by lowest run rate first to highlight issues
        });
    }

    const exportToCSV = () => {
        if (!displayData || displayData.length === 0) return;

        const headers = type === 'online'
            ? ['Name', 'Team', 'Status', 'Arrived', 'Shift Start']
            : type === 'productivity' ? ['Name', 'Team', 'Productivity %']
                : type === 'efficiency' ? ['Name', 'Team', 'Efficiency %']
                    : type === 'absenteeism' ? ['Name', 'Team', 'Scheduled Shift Start']
                        : type === 'adherence' ? ['Name', 'Team', 'Adherence %']
                            : type === 'overtime' ? ['Name', 'Team', 'Overtime (Sec)']
                                : (type === 'teams' || type === 'topTeam') ? ['Rank', 'Team Name', 'Members', 'Online', 'Avg. Productivity']
                                    : (type === 'totalHours' && filter === 'teams_view') ? ['Team Name', 'Total Hours', 'Tracked Employees']
                                        : type === 'totalHours' ? ['Name', 'Team', 'Hours Tracked', 'Status']
                                            : type === 'late' ? ['Name', 'Team', 'Arrived', 'Shift Start']
                                                : type === 'runRate' ? ['Name', 'Team', 'Actual Hours', 'Scheduled Hours', 'Run Rate %', 'Missing']
                                                    : ['Name', 'Team', 'Arrived', 'Shift Start'];

        const csvContent = [
            headers.join(','),
            ...displayData.map((item, index) => {
                let row = [];
                if (type === 'online') {
                    row = [item.name, item.group_name || item.team_name, item.is_online == 1 ? 'Online' : 'Offline', item.arrived || '-', item.work_starts];
                } else if (type === 'productivity') {
                    row = [item.name, item.group_name || item.team_name, item.productivity];
                } else if (type === 'efficiency') {
                    row = [item.name, item.group_name || item.team_name, item.efficiency];
                } else if (type === 'absenteeism') {
                    row = [item.name, item.group_name || item.team_name, item.work_starts || '-'];
                } else if (type === 'adherence') {
                    row = [item.name, item.group_name || item.team_name, calculateAdherence(item, serverTime).toFixed(1) + '%'];
                } else if (type === 'overtime') {
                    row = [item.name, item.group_name || item.team_name, (item.after_work_time / 60).toFixed(0) + ' min'];
                } else if (type === 'late') {
                    row = [item.name, item.group_name || item.team_name, item.arrived, item.work_starts];
                } else if (type === 'runRate') {
                    const adjSched = Math.max(parseFloat(item.mtd_scheduled || 0) - parseFloat(item.lunch_deduction_hours || 0), 0);
                    const rate = adjSched > 0 ? (item.mtd_actual / adjSched * 100).toFixed(1) + '%' : '0%';
                    const missing = Math.max(0, adjSched - item.mtd_actual).toFixed(2);
                    row = [item.name, item.group_name || item.team_name, Number(item.mtd_actual).toFixed(2), Number(adjSched).toFixed(2), rate, missing];
                } else {
                    if (type === 'totalHours') {
                        if (filter === 'teams_view') {
                            row = [item.group_name || item.team_name, (item.desktime_time / 3600).toFixed(2), item.employee_count];
                        } else {
                            row = [item.name, item.group_name || item.team_name, (item.desktime_time / 3600).toFixed(2), item.is_online == 1 ? 'Online' : 'Offline'];
                        }
                    } else if (type === 'teams' || type === 'topTeam') {
                        row = [index + 1, item.group_name || item.team_name, item.employee_count, item.online_count, parseFloat(item.avg_productivity).toFixed(1) + '%'];
                    } else {
                        row = [item.name, item.group_name || item.team_name, item.arrived, item.work_starts];
                    }
                }
                // Quote items to handle commas
                return row.map(val => `"${val}"`).join(',');
            })
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `employee_status_${type}_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="modal-overlay drilldown-modal" onClick={onClose}>
            <div className="modal-content drill-modal-content" onClick={e => e.stopPropagation()}>
                <header className="modal-header">
                    <div className="header-left">
                        <h2>{title}</h2>
                        <span className="record-count">
                            {displayData.length} {(type === 'teams' || type === 'topTeam' || (type === 'totalHours' && filter === 'teams_view')) ? 'teams' : 'employees'}
                        </span>
                        <button className="export-btn" onClick={exportToCSV} title="Export to CSV">
                            <span>📥</span> Export CSV
                        </button>
                    </div>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </header>

                <div className="modal-body">
                    <div className="modal-filters">
                        <div className="search-box">
                            <input
                                type="text"
                                placeholder="Search by name or team..."
                                value={modalSearchTerm}
                                onChange={(e) => setModalSearchTerm(e.target.value)}
                                className="modal-search-input"
                            />
                        </div>
                        {type === 'runRate' && (
                            <button className="daily-details-btn" onClick={() => setShowDailyDetails(true)}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                    <line x1="16" y1="2" x2="16" y2="6" />
                                    <line x1="8" y1="2" x2="8" y2="6" />
                                    <line x1="3" y1="10" x2="21" y2="10" />
                                    <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
                                </svg>
                                Daily Details
                            </button>
                        )}
                        {type === 'online' && (
                            <div className="filter-chips">
                                <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
                                <button className={`filter-chip ${filter === 'online' ? 'active' : ''}`} onClick={() => setFilter('online')}>Online</button>
                                <button className={`filter-chip ${filter === 'offline' ? 'active' : ''}`} onClick={() => setFilter('offline')}>Offline</button>
                            </div>
                        )}
                        {type === 'topTeam' && (
                            <div className="filter-chips">
                                <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All Teams</button>
                                <button className={`filter-chip ${filter === 'online' ? 'active' : ''}`} onClick={() => setFilter('online')}>Online Only</button>
                            </div>
                        )}
                        {type === 'totalHours' && (
                            <div className="filter-chips">
                                <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
                                <button className={`filter-chip ${filter === 'online' ? 'active' : ''}`} onClick={() => setFilter('online')}>Online</button>
                                <button className={`filter-chip ${filter === 'offline' ? 'active' : ''}`} onClick={() => setFilter('offline')}>Offline</button>
                                <button className={`filter-chip ${filter === 'teams_view' ? 'active' : ''}`} onClick={() => setFilter('teams_view')}>Teams</button>
                            </div>
                        )}

                    </div>

                    {loading ? (
                        <div className="modal-loading">Loading details...</div>
                    ) : error ? (
                        <div className="modal-error">Error: {error}</div>
                    ) : (
                        <div className="table-container">
                            <table className="drilldown-table">
                                <thead>
                                    <tr>
                                        {(type === 'teams' || type === 'topTeam') ? (
                                            <>
                                                {type === 'topTeam' && <th>#</th>}
                                                <th>Team Name</th>
                                                <th>Members</th>
                                                <th>Online</th>
                                                <th>Avg. Productivity</th>
                                            </>
                                        ) : (
                                            <>
                                                {!(type === 'totalHours' && filter === 'teams_view') && (
                                                    <>
                                                        <th>Name</th>
                                                        <th>Team</th>
                                                    </>
                                                )}
                                                {type === 'online' && (
                                                    <>
                                                        <th>Status</th>
                                                        <th>Arrived</th>
                                                        <th>Shift Start</th>
                                                    </>
                                                )}
                                                {type === 'productivity' && <th>Productivity %</th>}
                                                {type === 'efficiency' && <th>Efficiency %</th>}
                                                {type === 'absenteeism' && (
                                                    <>
                                                        <th>Latest Absence</th>
                                                        <th>Typical Shift</th>
                                                        <th>Lost Hours</th>
                                                        <th>Frequency</th>
                                                    </>
                                                )}
                                                {type === 'adherence' && (
                                                    <>
                                                        <th>Adherence %</th>
                                                    </>
                                                )}
                                                {type === 'overtime' && <th>Overtime (Sec)</th>}
                                                {type === 'totalHours' && (
                                                    filter === 'teams_view' ? (
                                                        <>
                                                            <th>Team Name</th>
                                                            <th>Total Hours Tracked</th>
                                                            <th>Tracked Employees</th>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <th>Hours Tracked</th>
                                                            <th>Status</th>
                                                        </>
                                                    )
                                                )}
                                                {type === 'late' && (
                                                    <>
                                                        <th>Arrived</th>
                                                        <th>Shift Start</th>
                                                    </>
                                                )}
                                                {type === 'runRate' && (
                                                    <>
                                                        <th>Actual Hours</th>
                                                        <th>Scheduled Hours</th>
                                                        <th>Run Rate %</th>
                                                        <th>Missing</th>
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayData.map((item, index) => (
                                        <tr key={index}>
                                            {(type === 'teams' || type === 'topTeam') ? (
                                                <>
                                                    {type === 'topTeam' && <td><strong>#{index + 1}</strong></td>}
                                                    <td>{item.group_name}</td>
                                                    <td>{item.employee_count}</td>
                                                    <td>{item.online_count}</td>
                                                    <td>
                                                        <div className="metric-cell">
                                                            <span className="metric-value">{parseFloat(item.avg_productivity).toFixed(1)}%</span>
                                                            <div className="mini-progress"><div className="fill" style={{ width: `${item.avg_productivity}%`, background: '#d69e2e' }}></div></div>
                                                        </div>
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    {!(type === 'totalHours' && filter === 'teams_view') && (
                                                        <>
                                                            <td>{item.name}</td>
                                                            <td>{item.group_name || item.team_name}</td>
                                                        </>
                                                    )}
                                                    {type === 'online' && (
                                                        <>
                                                            <td>
                                                                <span className={`status-badge ${item.is_online == 1 ? 'online' : 'offline'}`}>
                                                                    {item.is_online == 1 ? 'Online' : 'Offline'}
                                                                </span>
                                                            </td>
                                                            <td>{item.arrived || '-'}</td>
                                                            <td>{item.work_starts}</td>
                                                        </>
                                                    )}
                                                    {type === 'productivity' && (
                                                        <td>
                                                            <div className="metric-cell">
                                                                <span className="metric-value">{parseFloat(item.productivity).toFixed(1)}%</span>
                                                                <div className="mini-progress"><div className="fill" style={{ width: `${item.productivity}%`, background: '#4299e1' }}></div></div>
                                                            </div>
                                                        </td>
                                                    )}
                                                    {type === 'efficiency' && (
                                                        <td>
                                                            <div className="metric-cell">
                                                                <span className="metric-value">{parseFloat(item.efficiency).toFixed(1)}%</span>
                                                                <div className="mini-progress"><div className="fill" style={{ width: `${item.efficiency}%`, background: '#ed8936' }}></div></div>
                                                            </div>
                                                        </td>
                                                    )}
                                                    {type === 'absenteeism' && (
                                                        <>
                                                            <td>{item.log_date || '-'}</td>
                                                            <td>
                                                                <div className="shift-chip">
                                                                    {(() => {
                                                                        const start = item.work_starts || '08:00:00';
                                                                        const end = item.work_ends || '17:00:00';
                                                                        const formatTime = (t) => {
                                                                            const [h, m] = t.split(':');
                                                                            const hour = parseInt(h);
                                                                            return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
                                                                        };
                                                                        const duration = Math.max(0, (timeToSeconds(end) - timeToSeconds(start)) / 3600 - (item.lunch_deduction_hours || 0));
                                                                        return `${formatTime(start)} - ${formatTime(end)} (${duration.toFixed(1)}h)`;
                                                                    })()}
                                                                </div>
                                                            </td>
                                                            <td>{Math.max(0, ((timeToSeconds(item.work_ends || '17:00:00') - timeToSeconds(item.work_starts || '08:00:00')) / 3600) - (item.lunch_deduction_hours || 0)).toFixed(1)}h</td>
                                                            <td>
                                                                <span className="frequency-badge">
                                                                    {data.filter(d => d.employee_id === item.employee_id).length}x
                                                                </span>
                                                            </td>
                                                        </>
                                                    )}
                                                    {type === 'adherence' && (
                                                        <>
                                                            <td>
                                                                <div className="metric-cell">
                                                                    <span className="metric-value">{calculateAdherence(item, serverTime).toFixed(1)}%</span>
                                                                    <div className="mini-progress">
                                                                        <div
                                                                            className="fill"
                                                                            style={{
                                                                                width: `${calculateAdherence(item, serverTime)}%`,
                                                                                background: calculateAdherence(item, serverTime) > 90 ? '#38a169' : calculateAdherence(item, serverTime) > 70 ? '#ecc94b' : '#e53e3e'
                                                                            }}
                                                                        ></div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </>
                                                    )}
                                                    {type === 'overtime' && (
                                                        <td>
                                                            <span className="overtime-value">{(item.after_work_time / 60).toFixed(0)} min</span>
                                                        </td>
                                                    )}
                                                    {type === 'totalHours' && (
                                                        filter === 'teams_view' ? (
                                                            <>
                                                                <td>{item.group_name}</td>
                                                                <td>
                                                                    <div className="metric-cell">
                                                                        <span className="metric-value">{(item.desktime_time / 3600).toFixed(2)}</span>
                                                                        <div className="mini-progress"><div className="fill" style={{ width: `${Math.min((item.desktime_time / 3600) / 50 * 100, 100)}%`, background: '#3182ce' }}></div></div>
                                                                    </div>
                                                                </td>
                                                                <td>{item.employee_count} employees</td>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <td>
                                                                    <div className="metric-cell">
                                                                        <span className="metric-value">{(item.desktime_time / 3600).toFixed(2)}</span>
                                                                        <div className="mini-progress"><div className="fill" style={{ width: `${Math.min((item.desktime_time / 3600) / 12 * 100, 100)}%`, background: '#3182ce' }}></div></div>
                                                                    </div>
                                                                </td>
                                                                <td>
                                                                    <span className={`status-badge ${item.is_online == 1 ? 'online' : 'offline'}`}>
                                                                        {item.is_online == 1 ? 'Online' : 'Offline'}
                                                                    </span>
                                                                </td>
                                                            </>
                                                        )
                                                    )}
                                                    {type === 'late' && (
                                                        <>
                                                            <td className={isLate(item.arrived, item.work_starts, threshold) ? "text-danger" : ""}>
                                                                {item.arrived}
                                                            </td>
                                                            <td>{item.work_starts}</td>
                                                        </>
                                                    )}
                                                    {type === 'runRate' && (
                                                        <>
                                                            <td>{Number(item.mtd_actual).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}h</td>
                                                            <td>{(() => {
                                                                const adj = Math.max(parseFloat(item.mtd_scheduled || 0) - parseFloat(item.lunch_deduction_hours || 0), 0);
                                                                return Number(adj).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                                            })()}h</td>
                                                            <td>
                                                                <div className="metric-cell">
                                                                    <span className="metric-value">
                                                                        {(() => {
                                                                            const adj = Math.max(parseFloat(item.mtd_scheduled || 0) - parseFloat(item.lunch_deduction_hours || 0), 0);
                                                                            return adj > 0 ? (item.mtd_actual / adj * 100).toFixed(1) : '0.0';
                                                                        })()}%
                                                                    </span>
                                                                    <div className="mini-progress">
                                                                        <div
                                                                            className="fill"
                                                                            style={{
                                                                                width: `${(() => {
                                                                                    const adj = Math.max(parseFloat(item.mtd_scheduled || 0) - parseFloat(item.lunch_deduction_hours || 0), 0);
                                                                                    return Math.min((item.mtd_actual / (adj || 1)) * 100, 100);
                                                                                })()}%`,
                                                                                background: (() => {
                                                                                    const adj = Math.max(parseFloat(item.mtd_scheduled || 0) - parseFloat(item.lunch_deduction_hours || 0), 0);
                                                                                    return (item.mtd_actual / (adj || 1)) >= 0.9 ? '#38a169' : '#e53e3e';
                                                                                })()
                                                                            }}
                                                                        ></div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td style={{ color: '#e53e3e' }}>
                                                                {(() => {
                                                                    const adj = Math.max(parseFloat(item.mtd_scheduled || 0) - parseFloat(item.lunch_deduction_hours || 0), 0);
                                                                    return adj > item.mtd_actual
                                                                        ? `-${(adj - item.mtd_actual).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}h`
                                                                        : '0.00h';
                                                                })()}
                                                            </td>
                                                        </>
                                                    )}
                                                </>
                                            )}
                                        </tr>
                                    ))}
                                    {displayData.length === 0 && (
                                        <tr>
                                            <td colSpan="4" className="text-center">No records found</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
            {showDailyDetails && (
                <DailyDetailsModal 
                    isOpen={showDailyDetails} 
                    onClose={() => setShowDailyDetails(false)} 
                    fromDate={fromDateStr} 
                    toDate={toDateStr} 
                    team={team} 
                />
            )}
        </div>
    );
};

export default DrillDownModal;
