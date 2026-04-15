import React, { useState, useEffect } from 'react';
import './ReportSettings.css';

const REPORTS = [
    { id: 'sync-history', label: 'Sync History Log', icon: '📜' },
    { id: 'employee-hours', label: 'Employee Hours Report', icon: '🕒' },
    { id: 'coverage', label: 'Coverage Report', icon: '🎯' },
    { id: 'productivity', label: 'Productivity Report', icon: '⚡' },
    { id: 'punctuality', label: 'Punctuality Report', icon: '⏰' },
    { id: 'absenteeism', label: 'Absenteeism Report', icon: '📉' },
    { id: 'adherence', label: 'Adherence Report', icon: '✅' },
    { id: 'overtime', label: 'Overtime Report', icon: '🕒' },
    { id: 'total-hours', label: 'Total Hours Report', icon: '🕐' },
    { id: 'run-rate', label: 'Run Rate Report', icon: '📈' },
    { id: 'employee-projects', label: 'Employee Projects Report', icon: '🏗️' },
    { id: 'performance-kpi', label: 'Performance KPI', icon: '🎯' },
];

const ReportSettings = () => {
    const [visibleReports, setVisibleReports] = useState(REPORTS.map(r => r.id));

    useEffect(() => {
        const saved = localStorage.getItem('report_preferences');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.visibleReports) {
                setVisibleReports(parsed.visibleReports);
            }
        }
    }, []);

    const toggleReport = (reportId) => {
        const newVisible = visibleReports.includes(reportId)
            ? visibleReports.filter(id => id !== reportId)
            : [...visibleReports, reportId];
        
        setVisibleReports(newVisible);
        localStorage.setItem('report_preferences', JSON.stringify({ visibleReports: newVisible }));
    };

    return (
        <div className="settings-reports-container">
            <header className="settings-header">
                <h1>Report Visibility</h1>
                <p>Select which reports to display on the main Analytics dashboard.</p>
            </header>

            <section className="settings-section">
                <h2>Manage Active Reports</h2>
                <p className="section-desc">Toggle the switches below to hide or show specific report cards.</p>
                
                <div className="reports-toggle-grid">
                    {REPORTS.map(report => (
                        <div 
                            key={report.id} 
                            className={`report-toggle-card ${visibleReports.includes(report.id) ? 'active' : ''}`}
                            onClick={() => toggleReport(report.id)}
                        >
                            <div className="report-toggle-info">
                                <span className="report-icon">{report.icon}</span>
                                <span className="report-label">{report.label}</span>
                            </div>
                            <div className="toggle-switch">
                                <div className="switch-slider"></div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
};

export default ReportSettings;
