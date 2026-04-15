import React, { useState, useEffect } from 'react';
import './SyncHistory.css';
import LoadingScreen from './LoadingScreen';

const SyncHistory = ({ onBack }) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const response = await fetch('./api/get_sync_history.php');
            const result = await response.json();
            if (result.success) {
                setLogs(result.data || []);
            } else {
                setError(result.error);
            }
        } catch (err) {
            setError("Failed to connect to the server.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const formatDateTime = (dateStr) => {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr);
        return date.toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            hour: '2-digit', 
            minute: '2-digit'
        });
    };

    if (loading) return <LoadingScreen loading={loading} message="Loading Sync History..." />;

    return (
        <div className="sync-history-view">
            <header className="report-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <button className="back-btn" onClick={onBack}>← Back</button>
                    <div>
                        <h1>Sync History</h1>
                        <p className="subtitle">Last 30 synchronization events</p>
                    </div>
                </div>
                <button className="refresh-btn" onClick={fetchLogs}>🔄 Refresh Logs</button>
            </header>

            {error && <div className="error-banner">Error: {error}</div>}

            <div className="history-table-wrapper">
                <table className="history-table">
                    <thead>
                        <tr>
                            <th>Completed At</th>
                            <th>Target Date</th>
                            <th>Status</th>
                            <th>Functions & Tables Updated</th>
                            <th>Details / Errors</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.length > 0 ? (
                            logs.map((log) => (
                                <tr key={log.id}>
                                    <td className="font-mono">{formatDateTime(log.created_at)}</td>
                                    <td className="font-bold">{log.sync_date}</td>
                                    <td>
                                        <span className={`status-badge ${log.status}`}>
                                            {log.status.toUpperCase()}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="sync-detail-item">
                                            <span className="function-name">🕒 Save Hours</span>
                                            <span className="table-name">desktime_employee_data</span>
                                            <span className="count-badge">{log.hours_updated} records</span>
                                        </div>
                                        <div className="sync-detail-item" style={{ marginTop: '8px' }}>
                                            <span className="function-name">🏗️ Employee Project Report</span>
                                            <span className="table-name">desktime_project_data</span>
                                            <span className="count-badge">{log.projects_updated} tasks</span>
                                        </div>
                                    </td>
                                    <td className="error-cell" title={log.error_message}>
                                        <span className={`sync-type-badge ${log.sync_type || 'automatic'}`}>
                                            {log.sync_type || 'Automatic'}
                                        </span>
                                        {log.error_message || <span className="success-text">✓ No errors</span>}
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan="5" className="empty-state">No synchronization logs found.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default SyncHistory;
