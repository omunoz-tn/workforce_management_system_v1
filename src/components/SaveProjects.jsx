import { useState, useRef, useEffect } from 'react';
import './SaveProjects.css';

const SaveProjects = ({ onBack }) => {
    const today = new Date().toISOString().split('T')[0];
    const [fromDate, setFromDate] = useState(today);
    const [toDate, setToDate] = useState(today);
    const [selectedWeek, setSelectedWeek] = useState('');
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentStep, setCurrentStep] = useState('');
    const [status, setStatus] = useState(null); // { type: 'success' | 'error', message: string }
    const [logs, setLogs] = useState([]);
    const stopRequested = useRef(false);

    // Helper: Manage the last 12 weeks for the dropdown
    const getRecentWeeks = () => {
        const weeks = [];
        const now = new Date();
        let currentMonday = new Date(now);
        currentMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        currentMonday.setHours(12, 0, 0, 0);

        for (let i = 0; i < 12; i++) {
            const monday = new Date(currentMonday);
            monday.setDate(currentMonday.getDate() - (i * 7));
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);

            const mStr = monday.toISOString().split('T')[0];
            const sStr = sunday.toISOString().split('T')[0];

            // ISO Week Number
            const d = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

            weeks.push({
                label: `Week ${weekNum} (${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`,
                from: mStr,
                to: sStr,
                id: `${monday.getFullYear()}-W${weekNum}`
            });
        }
        return weeks;
    };

    const weeksList = getRecentWeeks();

    const handleQuickSelect = (e) => {
        const val = e.target.value;
        setSelectedWeek(val);
        
        const now = new Date();
        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        if (val === 'yesterday') {
            const yesterday = new Date();
            yesterday.setDate(now.getDate() - 1);
            const dateStr = formatDate(yesterday);
            setFromDate(dateStr);
            setToDate(dateStr);
        } else if (val === 'last_week') {
            const lastMonday = new Date();
            lastMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7);
            const lastSunday = new Date(lastMonday);
            lastSunday.setDate(lastMonday.getDate() + 6);
            setFromDate(formatDate(lastMonday));
            setToDate(formatDate(lastSunday));
        } else if (val === 'last_month') {
            const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
            setFromDate(formatDate(firstOfLastMonth));
            setToDate(formatDate(lastOfLastMonth));
        } else if (val === 'last_7_days') {
            const last7 = new Date();
            last7.setDate(now.getDate() - 7);
            setFromDate(formatDate(last7));
            setToDate(formatDate(now));
        } else if (val === 'last_30_days') {
            const last30 = new Date();
            last30.setDate(now.getDate() - 30);
            setFromDate(formatDate(last30));
            setToDate(formatDate(now));
        } else if (val === 'mtd') {
            const firstOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            setFromDate(formatDate(firstOfCurrentMonth));
            setToDate(formatDate(now));
        } else if (val === 'this_year') {
            const firstOfYear = new Date(now.getFullYear(), 0, 1);
            setFromDate(formatDate(firstOfYear));
            setToDate(formatDate(now));
        } else {
            const week = weeksList.find(w => w.id === val);
            if (week) {
                setFromDate(week.from);
                setToDate(week.to);
            }
        }
    };

    const addLog = (msg, type = 'info') => {
        setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, type }]);
    };

    const handleStop = () => {
        stopRequested.current = true;
    };

    const handleSaveProjects = async () => {
        if (new Date(fromDate) > new Date(toDate)) {
            setStatus({ type: 'error', message: 'From date cannot be later than To date' });
            return;
        }

        setLoading(true);
        setStatus(null);
        setProgress(0);
        setLogs([]);
        stopRequested.current = false;
        addLog(`Starting project sync from ${fromDate} to ${toDate}`);

        // Generate dates in range
        const dates = [];
        let dt = new Date(fromDate + 'T12:00:00');
        const endDt = new Date(toDate + 'T12:00:00');

        while (dt <= endDt) {
            dates.push(new Date(dt).toISOString().split('T')[0]);
            dt.setDate(dt.getDate() + 1);
        }

        const totalSteps = dates.length;
        let successCount = 0;

        for (let i = 0; i < dates.length; i++) {
            if (stopRequested.current) {
                addLog('Process stopped by user.', 'error');
                break;
            }

            const date = dates[i];
            setCurrentStep(`Syncing projects for ${date}...`);
            addLog(`Requesting project data for ${date}...`);

            try {
                // Specifically targeting sync_project_data.php for the manual range
                const response = await fetch(`./api/sync_project_data.php?from=${date}&to=${date}`);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    let errorMessage = `Server error ${response.status}`;
                    try {
                        const errorJson = JSON.parse(errorText);
                        errorMessage = errorJson.error || errorMessage;
                    } catch (e) {
                        // If it's not JSON, it might be a PHP error/timeout message
                        if (errorText.includes('Maximum execution time')) {
                            errorMessage = "Server timeout (took too long to process employees)";
                        } else {
                            errorMessage = errorText.substring(0, 100) || errorMessage;
                        }
                    }
                    throw new Error(errorMessage);
                }

                const result = await response.json();

                if (result.success) {
                    successCount++;
                    addLog(`Successfully synced projects for ${date} (${result.processed_tasks || 0} tasks)`, 'success');
                } else {
                    addLog(`Error syncing ${date}: ${result.error}`, 'error');
                }
            } catch (err) {
                addLog(`Failed for ${date}: ${err.message}`, 'error');
            }

            const newProgress = Math.round(((i + 1) / totalSteps) * 100);
            setProgress(newProgress);
        }

        setLoading(false);
        setCurrentStep('');

        if (stopRequested.current) {
            setStatus({ type: 'error', message: `Sync stopped by user. ${successCount}/${totalSteps} days successful.` });
        } else if (successCount === totalSteps) {
            setStatus({ type: 'success', message: `Successfully synced projects for ${totalSteps} days!` });
        } else {
            setStatus({ type: 'error', message: `Sync completed with issues. ${successCount}/${totalSteps} days successful.` });
        }
    };

    return (
        <div className="save-projects-container">
            <button className="back-btn" onClick={onBack}>← Back to Dashboard</button>
            
            <div className="save-projects-card">
                <header className="card-header">
                    <h2>Save Projects & Task</h2>
                    <p>Select a date range to fetch and store DeskTime project and task records locally.</p>
                </header>

                <div className="full-width-group form-group">
                    <label>Quick Select Range</label>
                    <select 
                        className="week-select" 
                        value={selectedWeek} 
                        onChange={handleQuickSelect}
                        disabled={loading}
                    >
                        <option value="">Custom Range...</option>
                        <optgroup label="Presets">
                            <option value="yesterday">Yesterday</option>
                            <option value="last_7_days">Last 7 Days</option>
                            <option value="last_30_days">Last 30 Days</option>
                            <option value="last_week">Last Week (Mon-Sun)</option>
                            <option value="last_month">Last Month</option>
                            <option value="mtd">Month to date (MTD)</option>
                            <option value="this_year">This Year</option>
                        </optgroup>
                        <optgroup label="Recent Weeks">
                            {weeksList.map(w => (
                                <option key={w.id} value={w.id}>{w.label}</option>
                            ))}
                        </optgroup>
                    </select>
                </div>

                <div className="form-grid">
                    <div className="form-group">
                        <label>From</label>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => {
                                setFromDate(e.target.value);
                                setSelectedWeek('');
                            }}
                            disabled={loading}
                        />
                    </div>
                    <div className="form-group">
                        <label>To</label>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => {
                                setToDate(e.target.value);
                                setSelectedWeek('');
                            }}
                            disabled={loading}
                        />
                    </div>
                </div>

                <div className="action-section">
                    <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                        <button
                            className="save-btn"
                            onClick={handleSaveProjects}
                            disabled={loading}
                            style={{ flex: 1 }}
                        >
                            {loading ? 'Processing...' : 'Save Projects to Database'}
                        </button>
                        {loading && (
                            <button
                                className="stop-btn"
                                onClick={handleStop}
                                style={{ 
                                    backgroundColor: '#fee2e2', 
                                    color: '#b91c1c', 
                                    flex: '0 0 auto',
                                    paddingLeft: '20px',
                                    paddingRight: '20px'
                                }}
                            >
                                Stop
                            </button>
                        )}
                    </div>

                    {loading && (
                        <div className="progress-container">
                            <div className="progress-info">
                                <span>{currentStep}</span>
                                <span>{progress}%</span>
                            </div>
                            <div className="progress-bar-bg">
                                <div
                                    className="progress-bar-fill"
                                    style={{ width: `${progress}%` }}
                                ></div>
                            </div>
                        </div>
                    )}

                    {status && (
                        <div className={`status-message ${status.type}`}>
                            <strong>{status.type === 'success' ? '✓ Success' : '⚠ Attention'}</strong>
                            <p>{status.message}</p>
                        </div>
                    )}

                    {logs.length > 0 && (
                        <div className="sync-logs">
                            {logs.map((log, i) => (
                                <div key={i} className={`log-entry ${log.type}`}>
                                    [{log.time}] {log.msg}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SaveProjects;
