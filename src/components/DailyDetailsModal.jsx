import React, { useState, useEffect, useMemo } from 'react';
import './DailyDetailsModal.css';

// `withProjection` (Run Rate Report, range reaching past today): days from today on come
// from the projection instead of DeskTime, each marked Projected so it is never mistaken
// for tracked time.
const DailyDetailsModal = ({ isOpen, onClose, fromDate, toDate, team, withProjection = false }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(15);

    useEffect(() => {
        if (!isOpen) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                let url = `./api/get_daily_run_rate.php?from=${fromDate}&to=${toDate}`;
                if (team) url += `&team=${encodeURIComponent(team)}`;

                let projectionUrl = null;
                if (withProjection) {
                    projectionUrl = `./api/get_run_rate_projection.php?from=${fromDate}&to=${toDate}&daily=1`;
                    if (team) projectionUrl += `&team=${encodeURIComponent(team)}`;
                }

                const [result, projection] = await Promise.all([
                    fetch(url).then(res => res.json()),
                    projectionUrl ? fetch(projectionUrl).then(res => res.json()) : Promise.resolve(null)
                ]);

                if (!result.success) {
                    setError(result.error);
                } else if (projection && !projection.success) {
                    setError(projection.error);
                } else if (projection && projection.projected_from) {
                    // Today onward is projected; the real rows for those dates (today's
                    // half-finished total) would double-count them.
                    const real = result.data.filter(item => item.log_date < projection.projected_from);
                    const projected = (projection.daily || []).filter(item => !Number(item.is_excluded));
                    setData([...real, ...projected].sort((a, b) =>
                        a.log_date.localeCompare(b.log_date) || (a.name || '').localeCompare(b.name || '')));
                } else {
                    setData(result.data);
                }
            } catch (err) {
                setError('Failed to fetch daily data');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [isOpen, fromDate, toDate, team, withProjection]);

    // Filtering
    const filteredData = useMemo(() => {
        return data.filter(item => 
            (item.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
            (item.team_name || "").toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [data, searchTerm]);

    // Reset to page 1 when search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    // Pagination
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const currentData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredData.slice(start, start + itemsPerPage);
    }, [filteredData, currentPage, itemsPerPage]);

    const exportToCSV = () => {
        if (!filteredData || filteredData.length === 0) return;

        const headers = ['Date', 'Type', 'Name', 'Team', 'Actual Hours', 'Scheduled Hours', 'Lunch Deduction', 'Run Rate %', 'Missing'];
        const csvContent = [
            headers.join(','),
            ...filteredData.map(item => {
                const adjScheduled = Math.max(parseFloat(item.daily_scheduled || 0) - parseFloat(item.lunch_deduction_hours || 0), 0);
                const actual = parseFloat(item.daily_actual || 0);
                const rate = adjScheduled > 0 ? (actual / adjScheduled * 100).toFixed(1) + '%' : '0%';
                const missing = Math.max(0, adjScheduled - actual).toFixed(2);
                
                const row = [
                    item.log_date,
                    item.projected ? 'Projected' : 'Actual',
                    item.name,
                    item.team_name,
                    actual.toFixed(2),
                    adjScheduled.toFixed(2),
                    parseFloat(item.lunch_deduction_hours || 0).toFixed(2),
                    rate,
                    missing
                ];
                return row.map(val => `"${val}"`).join(',');
            })
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `daily_run_rate_${team || 'all'}_${fromDate}_to_${toDate}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay daily-details-overlay" onClick={onClose}>
            <div className="modal-content daily-modal-content" onClick={e => e.stopPropagation()}>
                <header className="modal-header">
                    <div className="header-left">
                        <h2>Daily Run Rate Details</h2>
                        <span className="date-range-label">{fromDate} to {toDate}</span>
                        {team && <span className="team-label">Team: {team}</span>}
                        <button className="export-btn daily-export-btn" onClick={exportToCSV} title="Export to CSV">
                            <span>📥</span> Export CSV
                        </button>
                    </div>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </header>

                <div className="modal-body">
                    <div className="modal-filters daily-filters">
                        <div className="search-box">
                            <input
                                type="text"
                                placeholder="Search by name or team..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="modal-search-input"
                            />
                        </div>
                        <div className="pagination-info">
                            Showing {Math.min(filteredData.length, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(filteredData.length, currentPage * itemsPerPage)} of {filteredData.length} records
                        </div>
                    </div>

                    {loading ? (
                        <div className="modal-loading">Loading daily details...</div>
                    ) : error ? (
                        <div className="modal-error">Error: {error}</div>
                    ) : (
                        <>
                            <div className="table-container">
                                <table className="drilldown-table daily-table">
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            {withProjection && <th>Type</th>}
                                            <th>Name</th>
                                            <th>Team</th>
                                            <th>Actual</th>
                                            <th>Scheduled</th>
                                            <th>Run Rate %</th>
                                            <th>Missing</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {currentData.map((item, index) => {
                                            const adjScheduled = Math.max(parseFloat(item.daily_scheduled || 0) - parseFloat(item.lunch_deduction_hours || 0), 0);
                                            const actual = parseFloat(item.daily_actual || 0);
                                            const rate = adjScheduled > 0 ? (actual / adjScheduled * 100).toFixed(1) : '0.0';
                                            const missing = Math.max(0, adjScheduled - actual).toFixed(2);

                                            return (
                                                <tr key={index} className={item.projected ? 'daily-row-projected' : undefined}>
                                                    <td>{item.log_date}</td>
                                                    {withProjection && (
                                                        <td>
                                                            <span
                                                                className={`daily-type-badge ${item.projected ? 'is-projected' : 'is-actual'}`}
                                                                title={item.projected
                                                                    ? `Estimated: ${item.shift_start?.slice(0, 5)}–${item.shift_end?.slice(0, 5)} shift at a ${(Number(item.compliance_rate || 0) * 100).toFixed(0)}% historical compliance rate`
                                                                    : 'Tracked by DeskTime'}
                                                            >
                                                                {item.projected ? 'Projected' : 'Actual'}
                                                            </span>
                                                        </td>
                                                    )}
                                                    <td>{item.name}</td>
                                                    <td>{item.team_name}</td>
                                                    <td>{actual.toFixed(2)}h</td>
                                                    <td>{adjScheduled.toFixed(2)}h</td>
                                                    <td>
                                                        <div className="metric-cell">
                                                            <span className="metric-value">{rate}%</span>
                                                            <div className="mini-progress">
                                                                <div 
                                                                    className="fill" 
                                                                    style={{ 
                                                                        width: `${Math.min(parseFloat(rate), 100)}%`,
                                                                        background: parseFloat(rate) >= 90 ? '#38a169' : '#e53e3e'
                                                                    }}
                                                                ></div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td style={{ color: missing > 0 ? '#e53e3e' : 'inherit' }}>
                                                        {missing > 0 ? `-${missing}h` : '0.00h'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {currentData.length === 0 && (
                                            <tr>
                                                <td colSpan={withProjection ? 8 : 7} className="text-center">No records found</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {totalPages > 1 && (
                                <div className="pagination-controls">
                                    <button 
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="pag-btn"
                                    >
                                        &larr; Previous
                                    </button>
                                    <span className="page-indicator">
                                        Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
                                    </span>
                                    <button 
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        className="pag-btn"
                                    >
                                        Next &rarr;
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DailyDetailsModal;
