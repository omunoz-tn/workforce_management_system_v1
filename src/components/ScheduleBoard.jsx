import React, { useState, useEffect, useMemo } from 'react';
import './ScheduleBoard.css';
// The card markup used to live here as formatShift(); it moved to ShiftCard so Shift
// Management renders the identical card rather than a copy that can drift.
import ShiftCard, { shiftHours, formatTime } from './ShiftCard';
import { todayStr, parseDate, formatDate, mondayOf } from '../utils/dates';
import WeekPicker from './WeekPicker';
import { downloadCsv } from '../utils/csv';
import { HOLIDAY_TYPES } from './Holidays';


// Lucide's "calendar-pen" geometry, inlined because lucide-react 1.28.0 does not export it
// yet (CalendarCog is the closest it ships, and Holidays already uses that one for the
// Custom holiday type — reusing it here would make two different things look alike).
// Drawn with Lucide's own conventions so it sits consistently next to the icons that do
// come from the package: 24x24 box, 2px stroke, round caps and joins.
const IconEditSchedule = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
        <path d="M3 10h18" />
        <path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
    </svg>
);

const ScheduleBoard = ({ onEditSchedule = null }) => {
    // Anchored at noon on today's Santo Domingo date, so every week offset below stays on
    // the intended calendar day regardless of the machine's timezone.
    const [currentDate, setCurrentDate] = useState(() => parseDate());
    const [searchTerm, setSearchTerm] = useState('');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const monday = mondayOf(formatDate(currentDate));
    const weekDates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return formatDate(d);
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
        const matches = data.filter(emp =>
            emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (emp.team && emp.team.toLowerCase().includes(searchTerm.toLowerCase()))
        );
        if (!searchTerm.trim()) return matches;
        return [...matches].sort((a, b) => a.name.localeCompare(b.name));
    }, [data, searchTerm]);

    // Weekly Hours delegates to shiftHours so the column, each card's own total and the
    // Run Rate all apply the same two holiday rules. It used to inline the subtraction and
    // ignore holidays entirely, which made a Non-Working day still add its full shift here
    // while the Run Rate dropped it.
    const calcWeeklyHours = (emp) => {
        const lunchHours = (emp.lunch_time || 0) / 60; // minutes to hours
        return weekDates.reduce(
            (total, date) => total + shiftHours(emp.schedules[date], lunchHours),
            0
        );
    };



    // Exports exactly the rows on screen: it reads filteredData, the same array the table
    // renders, so the active search carries over without a second filtering path.
    // Laid out like the board — one row per employee, one column per day — so the file
    // reads the way the screen does.
    const handleExport = () => {
        const dayLabel = (date) => {
            const d = parseDate(date);
            return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${date}`;
        };

        // The same "most restrictive wins" order the card's tag uses, so a day labelled
        // Non-Working on screen is labelled Non-Working in the file.
        const holidayNote = (schedule) => {
            const holidays = schedule?.holidays || [];
            if (holidays.length === 0) return '';
            const rank = { non_working: 3, campaign_defined: 2, working: 1 };
            const worst = holidays.reduce((a, b) => (rank[b.type] || 0) > (rank[a.type] || 0) ? b : a);
            const type = HOLIDAY_TYPES.find(t => t.id === worst.type);
            const window = worst.from ? ` ${formatTime(worst.from)}-${formatTime(worst.to)} excluded` : '';
            return ` [${type ? type.badge : worst.type} Holiday${window}]`;
        };

        const cell = (schedule) => {
            const note = holidayNote(schedule);
            if (!schedule || schedule.start === '00:00:00') return `OFF${note}`;
            return `${formatTime(schedule.start)} - ${formatTime(schedule.end)}${note}`;
        };

        const rows = [
            ['Employee', 'Team', 'Weekly Hours', ...weekDates.map(dayLabel)],
            ...filteredData.map(emp => [
                emp.name,
                emp.team || 'Unassigned',
                calcWeeklyHours(emp).toFixed(2),
                ...weekDates.map(date => cell(emp.schedules[date]))
            ])
        ];

        downloadCsv(`Schedule_Board_${fromDate}_to_${toDate}.csv`, rows);
    };

    const isToday = (dateStr) => dateStr === todayStr();

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
                    <WeekPicker monday={monday} onChange={setCurrentDate} />

                    <button
                        type="button"
                        className="board-export-btn"
                        onClick={handleExport}
                        disabled={loading || filteredData.length === 0}
                        title={filteredData.length === 0
                            ? 'Nothing to export'
                            : `Export the ${filteredData.length} rows currently listed`}
                    >
                        Export
                    </button>
                </div>
            </header>

            <div className="board-main-area">
                <div className="table-outer-wrapper">
                    <table className="schedule-table">
                        <thead>
                            <tr>
                                <th className="sticky-col emp-header-cell">Employees / Team</th>
                                <th className="weekly-hours-header">Weekly Hours</th>
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
                                <tr><td colSpan="9" className="loading-state">
                                    <div className="spinner"></div>
                                    Loading schedule data...
                                </td></tr>
                            ) : error ? (
                                <tr><td colSpan="9" className="error-state">⚠️ {error}</td></tr>
                            ) : filteredData.length === 0 ? (
                                <tr><td colSpan="9" className="empty-state">NO DATA FOUND FOR THIS WEEK</td></tr>
                            ) : (
                                filteredData.map(emp => (
                                    <tr key={emp.id}>
                                        <td className="sticky-col emp-cell">
                                            <div className="emp-cell-inner">
                                                <div className="emp-card-info">
                                                    <span className="emp-name-text">{emp.name}</span>
                                                    <span className="emp-team-text">{emp.team || 'Unassigned'}</span>
                                                </div>
                                                {onEditSchedule && (
                                                    <button
                                                        type="button"
                                                        className="emp-edit-btn"
                                                        onClick={() => onEditSchedule(emp)}
                                                        title={`Edit ${emp.name}'s schedule in Shift Management`}
                                                        aria-label={`Edit ${emp.name}'s schedule`}
                                                    >
                                                        <IconEditSchedule />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td className="weekly-hours-cell">{calcWeeklyHours(emp).toFixed(2)}</td>
                                        {weekDates.map(date => {
                                            const schedule = emp.schedules[date];
                                            const todayClass = isToday(date) ? 'is-today-cell' : '';
                                            return (
                                                <td key={date} className={`schedule-cell ${todayClass}`}>
                                                    <ShiftCard schedule={schedule} lunchHours={(emp.lunch_time || 0) / 60} />
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
