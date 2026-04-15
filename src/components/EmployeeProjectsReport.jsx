import React, { useState, useEffect, useMemo } from 'react';
import './EmployeeProjectsReport.css';
import LoadingScreen from './LoadingScreen';

const EmployeeProjectsReport = ({ fromDate, toDate, onBack }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(50);

    // Helper: Format duration (seconds) to HH:MM:SS
    const formatDuration = (seconds) => {
        if (!seconds) return '0:00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    // Helper: Format date for display
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const fetchFromDB = async () => {
        try {
            const response = await fetch(`./api/get_employee_projects.php?from=${fromDate}&to=${toDate}`);
            const result = await response.json();
            if (result.success) {
                setData(result.data || []);
            }
        } catch (error) {
            console.error("DB Fetch Error:", error);
        }
    };

    useEffect(() => {
        const fetchAndLoad = async () => {
            setLoading(true);
            await fetchFromDB();
            setLoading(false);
        };

        if (fromDate && toDate) fetchAndLoad();
    }, [fromDate, toDate]);

    // Filtering logic
    const filteredData = useMemo(() => {
        return data.filter(row => 
            row.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.team.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.taskName.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [data, searchTerm]);
    
    // Summary Statistics
    const stats = useMemo(() => {
        const uniqueAgents = new Set(data.map(r => r.userName));
        const uniqueProjects = new Set(data.map(r => r.projectName));
        const totalDuration = data.reduce((sum, r) => sum + (parseInt(r.duration) || 0), 0);
        
        return {
            agents: uniqueAgents.size,
            projects: uniqueProjects.size,
            tasks: data.length,
            totalTime: totalDuration
        };
    }, [data]);

    // Pagination logic
    const totalPages = Math.ceil(filteredData.length / rowsPerPage);
    const paginatedData = useMemo(() => {
        if (rowsPerPage === -1) return filteredData;
        const start = (currentPage - 1) * rowsPerPage;
        return filteredData.slice(start, start + rowsPerPage);
    }, [filteredData, currentPage, rowsPerPage]);

    const handleExportXLSX = () => {
        const headers = ["Date", "User name", "Email", "Project name", "Task name", "Task time"];
        const rows = filteredData.map(row => [
            row.date,
            `"${row.userName}"`,
            row.email,
            `"${row.projectName}"`,
            `"${row.taskName}"`,
            formatDuration(row.duration)
        ]);

        const csvContent = [
            headers.join(","),
            ...rows.map(r => r.join(","))
        ].join("\n");

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Employee_Projects_Report_${fromDate}_to_${toDate}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (loading) return <LoadingScreen loading={loading} message="Generating Project Report..." />;

    return (
        <div className="project-report-view">
            <header className="report-header">
                <div className="header-left">
                    <button className="back-btn" onClick={onBack}>← Back</button>
                    <h1>Employee Projects Report</h1>
                    <span className="date-range-badge">
                        {formatDate(fromDate)} - {formatDate(toDate)}
                    </span>
                </div>
                <div className="header-actions">
                    <button className="export-btn" onClick={handleExportXLSX}>
                        <span className="icon">📊</span> Export CSV
                    </button>
                </div>
            </header>

            <div className="report-summary-dashboard">
                <div className="summary-card">
                    <div className="summary-icon">👥</div>
                    <div className="summary-info">
                        <span className="summary-label">Total Agents</span>
                        <span className="summary-value">{stats.agents}</span>
                    </div>
                </div>
                <div className="summary-card">
                    <div className="summary-icon">🏗️</div>
                    <div className="summary-info">
                        <span className="summary-label">Active Projects</span>
                        <span className="summary-value">{stats.projects}</span>
                    </div>
                </div>
                <div className="summary-card">
                    <div className="summary-icon">📝</div>
                    <div className="summary-info">
                        <span className="summary-label">Tasks Recorded</span>
                        <span className="summary-value">{stats.tasks}</span>
                    </div>
                </div>
                <div className="summary-card">
                    <div className="summary-icon">⏱️</div>
                    <div className="summary-info">
                        <span className="summary-label">Total Time Worked</span>
                        <span className="summary-value">{formatDuration(stats.totalTime)}</span>
                    </div>
                </div>
            </div>

            <div className="report-controls">
                <div className="search-box">
                    <span className="search-icon">🔍</span>
                    <input 
                        type="text" 
                        placeholder="Filter by name, team or project..." 
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setCurrentPage(1);
                        }}
                    />
                </div>
            </div>

            <div className="report-table-container">
                <table className="project-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>User name</th>
                            <th>Email</th>
                            <th>Project name</th>
                            <th>Task name</th>
                            <th>Task time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedData.length > 0 ? (
                            paginatedData.map((row, idx) => (
                                <tr key={idx}>
                                    <td>{row.date}</td>
                                    <td><strong>{row.userName}</strong></td>
                                    <td className="text-muted">{row.email}</td>
                                    <td><span className="project-badge">{row.projectName}</span></td>
                                    <td>{row.taskName}</td>
                                    <td className="time-col">{formatDuration(row.duration)}</td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan="6" className="no-data">No records found for the selected criteria.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {(totalPages > 1 || filteredData.length > 20) && (
                <div className="pagination">
                    <div className="rows-selector">
                        <span>Show:</span>
                        <select 
                            value={rowsPerPage === -1 ? 'all' : rowsPerPage} 
                            onChange={(e) => {
                                const val = e.target.value;
                                setRowsPerPage(val === 'all' ? -1 : parseInt(val));
                                setCurrentPage(1);
                            }}
                        >
                            <option value="20">20</option>
                            <option value="50">50</option>
                            <option value="100">100</option>
                            <option value="all">All</option>
                        </select>
                    </div>

                    {rowsPerPage !== -1 && (
                        <div className="pagination-controls">
                            <button 
                                disabled={currentPage === 1} 
                                onClick={() => setCurrentPage(prev => prev - 1)}
                            >
                                Previous
                            </button>
                            <span className="page-info">
                                Page {currentPage} of {totalPages}
                            </span>
                            <button 
                                disabled={currentPage === totalPages} 
                                onClick={() => setCurrentPage(prev => prev + 1)}
                            >
                                Next
                            </button>
                        </div>
                    )}

                    <div className="total-count">
                        Total Records: <strong>{filteredData.length}</strong>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmployeeProjectsReport;
