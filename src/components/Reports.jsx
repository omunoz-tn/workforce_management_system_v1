import React, { useState, useEffect } from 'react';
import './Reports.css';
import DateRangeModal from './DateRangeModal';

const REPORTS_DATA = [
    {
        id: 'sync-history',
        title: 'Sync History Log',
        description: 'View the history of automated background synchronizations and error logs.',
        icon: '📜',
        status: 'active',
        category: 'Maintenance'
    },
    {
        id: 'employee-hours',
        title: 'Employee Hours Report',
        description: 'Detailed breakdown of hours worked per employee and team.',
        icon: '🕒',
        status: 'active',
        category: 'Attendance'
    },
    {
        id: 'coverage',
        title: 'Coverage Report',
        description: 'Historical staffing coverage and scheduled vs actual presence.',
        icon: '🎯',
        status: 'active',
        category: 'Analytics'
    },
    {
        id: 'productivity',
        title: 'Productivity Report',
        description: 'Average productivity trends and top performing individuals over time.',
        icon: '⚡',
        status: 'active',
        category: 'Performance'
    },
    {
        id: 'punctuality', // matches 'late' in Dashboard
        title: 'Punctuality Report',
        description: 'Analysis of late arrivals and shift start adherence patterns.',
        icon: '⏰',
        status: 'active',
        category: 'Attendance'
    },
    {
        id: 'absenteeism',
        title: 'Absenteeism Report',
        description: 'Detailed view of no-shows and unscheduled absences.',
        icon: '📉',
        status: 'active',
        category: 'Attendance'
    },
    {
        id: 'adherence',
        title: 'Adherence Report',
        description: 'Shift compliance tracking and adherence to scheduled work blocks.',
        icon: '✅',
        status: 'active',
        category: 'Performance'
    },
    {
        id: 'overtime',
        title: 'Overtime Report',
        description: 'Historical overtime accumulation and distribution across teams.',
        icon: '🕒',
        status: 'active',
        category: 'Payroll'
    },
    {
        id: 'total-hours',
        title: 'Total Hours Report',
        description: 'Summary of total tracked hours across the entire organization.',
        icon: '🕐',
        status: 'active',
        category: 'Payroll'
    },
    {
        id: 'run-rate',
        title: 'Run Rate Report',
        description: 'Historical run rate trends and projection vs scheduled hours.',
        icon: '📈',
        status: 'active',
        category: 'Analytics'
    },
    {
        id: 'employee-projects',
        title: 'Employee Projects Report',
        description: 'Detailed report of tasks and projects worked per employee.',
        icon: '🏗️',
        status: 'active',
        category: 'Analytics'
    },
    {
        id: 'performance-kpi',
        title: 'Performance KPI',
        description: 'Visual representation of key performance indicators and meeting operational targets.',
        icon: '🎯',
        status: 'placeholder',
        category: 'Analytics'
    }
];

const Reports = ({ onLaunchReport }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedReport, setSelectedReport] = useState(null);
    const [visibleReports, setVisibleReports] = useState(REPORTS_DATA.map(r => r.id));

    useEffect(() => {
        const saved = localStorage.getItem('report_preferences');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.visibleReports) {
                setVisibleReports(parsed.visibleReports);
            }
        }
    }, []);

    const filteredReports = REPORTS_DATA.filter(r => visibleReports.includes(r.id));

    const handleCardClick = (report) => {
        if (report.status === 'active') {
            if (report.id === 'sync-history') {
                onLaunchReport(report.id);
                return;
            }
            setSelectedReport(report.id);
            setIsModalOpen(true);
        }
    };

    const handleConfirmDateRange = (from, to) => {
        setIsModalOpen(false);
        if (selectedReport) {
            if (onLaunchReport) {
                onLaunchReport(selectedReport, from, to);
            } else {
                // Fallback for standalone use if any
                window.open(`./?view=report-${selectedReport}&from=${from}&to=${to}`, '_blank');
            }
        }
    };

    return (
        <div className="reports-container">
            <header className="reports-header">
                <h1>Analytics Reports</h1>
                <p>Select a report to view detailed analytics and performance data.</p>
            </header>

            <div className="reports-grid">
                {filteredReports.map((report) => (
                    <div
                        key={report.id}
                        className={`report-card ${report.status}`}
                        onClick={() => handleCardClick(report)}
                    >
                        <div className="report-badge">{report.category}</div>
                        <div className="report-icon">{report.icon}</div>
                        <div className="report-content">
                            <h3>{report.title}</h3>
                            <p>{report.description}</p>
                        </div>
                        <div className="report-footer">
                            {report.status === 'active' ? (
                                <button className="view-report-btn">View Report</button>
                            ) : (
                                <span className="coming-soon">Coming Soon</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <DateRangeModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onConfirm={handleConfirmDateRange}
            />
        </div>
    );
};

export default Reports;
