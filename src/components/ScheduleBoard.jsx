import React, { useState, useEffect, useMemo } from 'react';
import './ScheduleBoard.css';

const ScheduleBoard = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [searchTerm, setSearchTerm] = useState('');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Calculate Monday of the current week (Mon-Sun view)
    const getMonday = (date) => {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(d.setDate(diff));
    };

    const monday = getMonday(currentDate);
    const weekDates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d.toISOString().split('T')[0];
    });

    const fromDate = weekDates[0];
    const toDate = weekDates[6];

    useEffect(() => {
        const fetchSchedule = async () => {
            setLoading(true);
            try {
                const response = await fetch(`./api/get_schedule_board.php?from=${fromDate}&to=${toDate}`);
                const result = await response.json();
                if (result.success) {
                    setData(result.data);
                    setError(null);
                } else {
                    setError(result.error);
                }
            } catch (err) {
                setError("Failed to fetch schedule data.");
            } finally {
                setLoading(false);
            }
        };

        fetchSchedule();
    }, [fromDate, toDate]);

    const filteredData = useMemo(() => {
        return data.filter(emp => 
            emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (emp.team && emp.team.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [data, searchTerm]);

    const navigateWeek = (weeks) => {
        const newDate = new Date(currentDate);
        newDate.setDate(currentDate.getDate() + (weeks * 7));
        setCurrentDate(newDate);
    };

    const formatShift = (schedule) => {
        if (!schedule || schedule.start === '00:00:00') return <span className="shift-off">OFF</span>;
        
        const formatTime = (t) => {
            if (!t || t === '00:00:00') return '-';
            const [h, m] = t.split(':');
            const hh = parseInt(h);
            const ampm = hh >= 12 ? 'PM' : 'AM';
            const displayHour = hh % 12 || 12;
            return `${displayHour}:${m} ${ampm}`;
        };

        return (
            <div className="shift-card">
                <span className="shift-time">{formatTime(schedule.start)}</span>
                <span className="shift-separator">-</span>
                <span className="shift-time">{formatTime(schedule.end)}</span>
            </div>
        );
    };

    const isToday = (dateStr) => {
        const todayStr = new Date().toISOString().split('T')[0];
        return dateStr === todayStr;
    }

    return (
        <div className="schedule-board-container">
            <header className="board-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1>Schedule Board</h1>
                        <span className="badge">{filteredData.length} Staff</span>
                    </div>
                    <div className="week-range-label">
                        📅 {new Date(fromDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} 
                        — 
                        {new Date(toDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                </div>

                <div className="header-controls">
                    <div className="search-filter-wrapper">
                        <div className="search-box">
                            <span className="search-icon">🔍</span>
                            <input 
                                type="text" 
                                placeholder="Search name or team..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="navigation-controls">
                        <button className="nav-btn prev" onClick={() => navigateWeek(-1)} title="Previous Week">←</button>
                        <button className="nav-btn today" onClick={() => setCurrentDate(new Date())}>Current Week</button>
                        <button className="nav-btn next" onClick={() => navigateWeek(1)} title="Next Week">→</button>
                    </div>
                </div>
            </header>

            <div className="board-main-area">
                <div className="table-outer-wrapper">
                    <table className="schedule-table">
                        <thead>
                            <tr>
                                <th className="sticky-col emp-header-cell">Employees / Team</th>
                                {weekDates.map(date => (
                                    <th key={date} className={isToday(date) ? 'today-col-header' : ''}>
                                        <div className="day-header-content">
                                            <span className="day-name">{new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</span>
                                            <span className="day-date">{new Date(date + 'T12:00:00').getDate()}</span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan="8" className="loading-state">
                                    <div className="spinner"></div>
                                    Loading schedule data...
                                </td></tr>
                            ) : error ? (
                                <tr><td colSpan="8" className="error-state">⚠️ {error}</td></tr>
                            ) : filteredData.length === 0 ? (
                                <tr><td colSpan="8" className="empty-state">NO DATA FOUND FOR THIS WEEK</td></tr>
                            ) : (
                                filteredData.map(emp => (
                                    <tr key={emp.id}>
                                        <td className="sticky-col emp-cell">
                                            <div className="emp-card-info">
                                                <span className="emp-name-text">{emp.name}</span>
                                                <span className="emp-team-text">{emp.team || 'Unassigned'}</span>
                                            </div>
                                        </td>
                                        {weekDates.map(date => {
                                            const schedule = emp.schedules[date];
                                            const todayClass = isToday(date) ? 'is-today-cell' : '';
                                            return (
                                                <td key={date} className={`schedule-cell ${todayClass}`}>
                                                    {formatShift(schedule)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default ScheduleBoard;
