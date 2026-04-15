import React, { useState, useEffect } from 'react';
import './HoursReportView.css';
import LoadingScreen from './LoadingScreen';

const ReportPeriodEditor = ({ initialFrom, initialTo, onApply }) => {
    const [localFrom, setLocalFrom] = useState(initialFrom || '');
    const [localTo, setLocalTo] = useState(initialTo || '');

    useEffect(() => {
        setLocalFrom(initialFrom || '');
        setLocalTo(initialTo || '');
    }, [initialFrom, initialTo]);

    const handleQuickSelect = (e) => {
        const preset = e.target.value;
        if (!preset) return;

        const now = new Date();
        let from = new Date();
        let to = new Date();

        const formatDate = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        switch (preset) {
            case 'today':
                break;
            case 'yesterday':
                from.setDate(now.getDate() - 1);
                to.setDate(now.getDate() - 1);
                break;
            case 'this_week': {
                const day = now.getDay();
                const diff = now.getDate() - (day === 0 ? 6 : day - 1);
                from.setDate(diff);
                break;
            }
            case 'last_week': {
                const day = now.getDay();
                const monDiff = now.getDate() - (day === 0 ? 6 : day - 1) - 7;
                from.setDate(monDiff);
                to.setDate(monDiff + 6);
                break;
            }
            case 'this_month':
                from = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'last_month':
                from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                to = new Date(now.getFullYear(), now.getMonth(), 0);
                break;
            case 'last_7_days':
                from.setDate(now.getDate() - 6);
                break;
            case 'last_30_days':
                from.setDate(now.getDate() - 29);
                break;
            default:
                return;
        }

        const newFrom = formatDate(from);
        const newTo = formatDate(to);
        setLocalFrom(newFrom);
        setLocalTo(newTo);
        
        // Reset the select after selection
        e.target.value = "";
    };

    return (
        <div className="report-period-editor no-print">
            <span>Period:</span>
            <div className="date-input-group">
                <input
                    type="date"
                    value={localFrom}
                    onChange={(e) => setLocalFrom(e.target.value)}
                    className="inline-date-input"
                />
                <span className="date-sep">to</span>
                <input
                    type="date"
                    value={localTo}
                    onChange={(e) => setLocalTo(e.target.value)}
                    className="inline-date-input"
                />
                <select 
                    className="quick-select-dropdown" 
                    onChange={handleQuickSelect}
                    defaultValue=""
                >
                    <option value="" disabled>Quick Select...</option>
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="this_week">This Week</option>
                    <option value="last_week">Last Week</option>
                    <option value="this_month">This Month</option>
                    <option value="last_month">Last Month</option>
                    <option value="last_7_days">Last 7 Days</option>
                    <option value="last_30_days">Last 30 Days</option>
                </select>
                <button onClick={() => onApply(localFrom, localTo)} className="apply-btn">Update Report</button>
            </div>
        </div>
    );
};

const HoursReportView = ({ fromDate: propFrom, toDate: propTo, onBack }) => {
    const [reportData, setReportData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Local states for the date editor
    const params = new URLSearchParams(window.location.search);
    const [fromDate, setFromDate] = useState(propFrom || params.get('from') || '');
    const [toDate, setToDate] = useState(propTo || params.get('to') || '');
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Utility to format numbers with commas
    const formatNum = (num) => {
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
    };

    // Generate array of dates in range
    const getDatesInRange = (start, end) => {
        const dates = [];
        let curr = new Date(start + 'T12:00:00'); // Use noon to avoid timezone issues
        const last = new Date(end + 'T12:00:00');
        while (curr <= last) {
            dates.push(curr.toISOString().split('T')[0]);
            curr.setDate(curr.getDate() + 1);
        }
        return dates;
    };

    // Helper for ISO week numbering (Monday start)
    const getWeekNumber = (dateString) => {
        const date = new Date(dateString + 'T12:00:00');
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    };

    // Helper for US Holidays (fixed date and some floating)
    const getUSHoliday = (dateString) => {
        const d = new Date(dateString + 'T12:00:00');
        const month = d.getMonth() + 1; // 1-12
        const date = d.getDate();
        const day = d.getDay(); // 0 = Sun, 1 = Mon ...
        const year = d.getFullYear();

        // 1. Fixed Date Holidays
        if (month === 1 && date === 1) return "New Year's Day";
        if (month === 6 && date === 19) return "Juneteenth";
        if (month === 7 && date === 4) return "Independence Day";
        if (month === 11 && date === 11) return "Veterans Day";
        if (month === 12 && date === 25) return "Christmas Day";

        // Helper to find the Nth occurrence of a weekday in a month
        const isNthDayOfMonth = (n, weekday) => {
            if (day !== weekday) return false;
            const expectedStart = 1 + (n - 1) * 7;
            const expectedEnd = n * 7;
            return date >= expectedStart && date <= expectedEnd;
        };

        const isLastDayOfMonth = (weekday) => {
            if (day !== weekday) return false;
            const daysInMonth = new Date(year, month, 0).getDate();
            return date > daysInMonth - 7;
        };

        // 2. Floating Date Holidays
        if (month === 1 && isNthDayOfMonth(3, 1)) return "Martin Luther King Jr. Day"; // 3rd Mon Jan
        if (month === 2 && isNthDayOfMonth(3, 1)) return "Presidents' Day"; // 3rd Mon Feb
        if (month === 5 && isLastDayOfMonth(1)) return "Memorial Day"; // Last Mon May
        if (month === 9 && isNthDayOfMonth(1, 1)) return "Labor Day"; // 1st Mon Sep
        if (month === 10 && isNthDayOfMonth(2, 1)) return "Columbus Day"; // 2nd Mon Oct
        if (month === 11 && isNthDayOfMonth(4, 4)) return "Thanksgiving Day"; // 4th Thu Nov

        return null;
    };

    const isWeekend = (dateString) => {
        const d = new Date(dateString + 'T12:00:00');
        return d.getDay() === 0 || d.getDay() === 6; // Sun or Sat
    };

    const [selectedYear, setSelectedYear] = useState('All');
    const [selectedWeek, setSelectedWeek] = useState('All');
    const [showOnlyActive, setShowOnlyActive] = useState(false);

    const dateColumns = (fromDate && toDate) ? getDatesInRange(fromDate, toDate) : [];

    // Derive available years and weeks from current report range
    const availableYears = React.useMemo(() => {
        const years = new Set();
        dateColumns.forEach(d => years.add(d.split('-')[0]));
        return ['All', ...Array.from(years).sort()];
    }, [dateColumns]);

    const availableWeeks = React.useMemo(() => {
        const weeks = new Set();
        dateColumns.forEach(d => {
            if (selectedYear === 'All' || d.startsWith(selectedYear)) {
                weeks.add(getWeekNumber(d));
            }
        });
        return ['All', ...Array.from(weeks).sort((a, b) => a - b)];
    }, [dateColumns, selectedYear]);

    // Visible columns after filtering
    const visibleDateColumns = React.useMemo(() => {
        return dateColumns.filter(d => {
            const yearMatch = selectedYear === 'All' || d.startsWith(selectedYear);
            const weekMatch = selectedWeek === 'All' || getWeekNumber(d).toString() === selectedWeek.toString();
            return yearMatch && weekMatch;
        });
    }, [dateColumns, selectedYear, selectedWeek]);

    useEffect(() => {
        if (selectedWeek !== 'All' && !availableWeeks.includes(Number(selectedWeek)) && !availableWeeks.includes(selectedWeek)) {
            setSelectedWeek('All');
        }
    }, [selectedYear, availableWeeks]);

    useEffect(() => {
        const fetchReport = async () => {
            setLoading(true); // Always show loading when fetching
            try {
                const response = await fetch(`./api/get_hours_report.php?from=${fromDate}&to=${toDate}`);
                const result = await response.json();

                if (result.success) {
                    setReportData(result.data);
                } else {
                    setError(result.error);
                }
            } catch (err) {
                setError("Failed to connect to the server.");
            } finally {
                setLoading(false);
            }
        };

        if (fromDate && toDate) {
            fetchReport();
        } else {
            setError("Invalid report parameters.");
            setLoading(false);
        }
    }, [fromDate, toDate, refreshTrigger]);
    const [targetWeeklyHours, setTargetWeeklyHours] = useState(40.00);
    const [isAdjustedView, setIsAdjustedView] = useState(false);

    const handleApplyDates = (newFrom, newTo) => {
        if (!newFrom || !newTo) {
            alert("Please select both dates.");
            return;
        }

        // Wipe old data and set loading state to immediately remove heavy table from DOM
        setLoading(true);
        setReportData([]);

        setFromDate(newFrom);
        setToDate(newTo);

        // Synchronize URL parameters (match the process of a new report launch)
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('from', localFrom);
        newUrl.searchParams.set('to', localTo);
        window.history.pushState({}, '', newUrl);

        setIsAdjustedView(false); // Reset adjustment view on date change
        setRefreshTrigger(prev => prev + 1);
    };

    // --- Minimal-Impact Adjustment Algorithm ---
    const getAdjustedEmployees = (employees) => {
        return employees.map(emp => {
            const currentTotal = emp.total;
            const target = Number(targetWeeklyHours);
            if (currentTotal <= target) return { ...emp, isAdjusted: false };

            let excess = currentTotal - target;
            const dailyHours = { ...emp.dailyHours };
            const workingDates = visibleDateColumns.filter(d => (dailyHours[d] || 0) > 0);
            
            if (workingDates.length === 0) return { ...emp, isAdjusted: false };

            // Sort working dates by hours descending
            const getSortedDates = () => [...workingDates].sort((a, b) => (dailyHours[b] || 0) - (dailyHours[a] || 0));

            // Implementation of minimal-impact logic
            const adjustPass = (threshold, floor) => {
                let sorted = getSortedDates();
                for (let date of sorted) {
                    if (excess <= 0) break;
                    const hours = dailyHours[date] || 0;
                    if (hours > threshold) {
                        const canReduce = Math.min(excess, hours - floor);
                        if (canReduce > 0) {
                            dailyHours[date] = Number((hours - canReduce).toFixed(2));
                            excess = Number((excess - canReduce).toFixed(2));
                        }
                    }
                }
            };

            // 1. Priority: Days above 10 hours (bring down to 9)
            adjustPass(10, 9);
            
            // 2. Secondary: Days above 9 hours (bring down to 8)
            if (excess > 0) adjustPass(9, 8);
            
            // 3. Tertiary: Days above 8 hours (bring down to 8)
            if (excess > 0) adjustPass(8, 8);

            // 4. Last Resort: Proportional reduction below 8 if still needed
            if (excess > 0) {
                let sorted = getSortedDates();
                for (let date of sorted) {
                    if (excess <= 0) break;
                    const hours = dailyHours[date] || 0;
                    const canReduce = Math.min(excess, hours); // Take what's needed
                    dailyHours[date] = Number((hours - canReduce).toFixed(2));
                    excess = Number((excess - canReduce).toFixed(2));
                }
            }

            // Recalculate totals
            let newTotal = Object.values(dailyHours).reduce((sum, h) => sum + h, 0);

            // Final Precision Correction: Ensure the sum of rounded daily hours 
            // exactly matches the target if an adjustment was made.
            const finalTarget = Number(target.toFixed(2));
            const diff = Number((finalTarget - newTotal).toFixed(2));
            
            if (Math.abs(diff) >= 0.01) {
                const sorted = getSortedDates();
                if (sorted.length > 0) {
                    const topDate = sorted[0];
                    dailyHours[topDate] = Number((dailyHours[topDate] + diff).toFixed(2));
                    newTotal = Number((newTotal + diff).toFixed(2));
                }
            }

            return {
                ...emp,
                dailyHours,
                total: newTotal,
                isAdjusted: true
            };
        });
    };

    // Process data into a matrix (one row per employee), calculating totals ONLY for visible columns
    const processedEmployees = React.useMemo(() => {
        const empMap = {};
        reportData.forEach(item => {
            if (!empMap[item.name]) {
                empMap[item.name] = {
                    name: item.name,
                    team: item.group || 'N/A',
                    dailyHours: {},
                    dailySeconds: {},
                    total: 0,
                    totalSeconds: 0
                };
            }
            empMap[item.name].dailyHours[item.date] = item.hours;
            empMap[item.name].dailySeconds[item.date] = item.seconds;
        });

        // Object values and then calculate totals based on visible columns
        let employees = Object.values(empMap)
            .map(emp => {
                let totalSecs = 0;
                visibleDateColumns.forEach(date => {
                    totalSecs += emp.dailySeconds[date] || 0;
                });
                return {
                    ...emp,
                    totalSeconds: totalSecs,
                    total: totalSecs / 3600
                };
            });

        // Apply Adjustment if active
        if (isAdjustedView) {
            employees = getAdjustedEmployees(employees);
        }

        return employees
            .filter(emp =>
                (emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    emp.team.toLowerCase().includes(searchTerm.toLowerCase())) &&
                (!showOnlyActive || emp.total >= 0.01)
            )
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [reportData, searchTerm, visibleDateColumns, isAdjustedView, targetWeeklyHours]);

    const totalReportHours = processedEmployees.reduce((sum, emp) => sum + emp.total, 0);

    const handleExportCSV = () => {
        const headers = ['Employee Name', 'Team', ...visibleDateColumns, 'Total Hours'];
        const rows = processedEmployees.map(emp => [
            `"${emp.name}"`,
            `"${emp.team}"`,
            ...visibleDateColumns.map(date => emp.dailyHours[date] || 0),
            emp.total.toFixed(2)
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `Employee_Hours_${fromDate}_to_${toDate}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Calculate column totals ONLY for visible columns
    const columnTotals = React.useMemo(() => {
        const totals = {};
        visibleDateColumns.forEach(date => {
            const totalSecs = processedEmployees.reduce((sum, emp) => sum + (emp.dailySeconds?.[date] || 0), 0);
            totals[date] = totalSecs / 3600;
        });
        return totals;
    }, [processedEmployees, visibleDateColumns]);

    return (
        <div className="report-view-container">
            <LoadingScreen loading={loading} message="Generating Report..." />

            {error && <div className="report-error">Error: {error}</div>}

            {(reportData.length > 0 || !loading) && !error && (
                <>
                    <header className="report-view-header">
                        <div className="report-title-section" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                            <button
                                onClick={onBack || (() => window.close())}
                                className="back-arrow-btn no-print"
                                title="Back to Reports"
                            >
                                ←
                            </button>
                            <div>
                                <h1>Employee Hours Report</h1>
                                <ReportPeriodEditor 
                                    initialFrom={fromDate} 
                                    initialTo={toDate} 
                                    onApply={handleApplyDates} 
                                />
                                <p className="report-period print-only">Period: {fromDate} to {toDate}</p>
                            </div>
                        </div>
                        <div className="report-actions no-print">
                            <button onClick={handleExportCSV} className="export-btn">Export CSV</button>
                        </div>
                    </header>

                    <div className="report-summary">
                        <div className="summary-card">
                            <div className="summary-icon">👥</div>
                            <div className="summary-info">
                                <span className="summary-label">Total Employees</span>
                                <span className="summary-value">{processedEmployees.length}</span>
                            </div>
                        </div>
                        <div className="summary-card">
                            <div className="summary-icon">⏱️</div>
                            <div className="summary-info">
                                <span className="summary-label">Total Hours</span>
                                <span className="summary-value">{formatNum(totalReportHours)}</span>
                            </div>
                        </div>
                        <div className="summary-card">
                            <div className="summary-icon">📊</div>
                            <div className="summary-info">
                                <span className="summary-label">Avg Hours / Emp</span>
                                <span className="summary-value">
                                    {processedEmployees.length > 0 ? formatNum(totalReportHours / processedEmployees.length) : '0.00'}
                                </span>
                            </div>
                        </div>
                        <div className="summary-card">
                            <div className="summary-icon">🗓️</div>
                            <div className="summary-info">
                                <span className="summary-label">Days Covered</span>
                                <span className="summary-value">{visibleDateColumns.length}</span>
                            </div>
                        </div>
                    </div>

                    <div className="report-controls no-print">
                        <div className="controls-group">
                            <div className="search-box">
                                <input
                                    type="text"
                                    placeholder="Filter by name or team..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <div className="advanced-filters">
                                <div className="filter-item">
                                    <label>Year</label>
                                    <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}>
                                        {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                </div>
                                <div className="filter-item">
                                    <label>Week #</label>
                                    <select value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)}>
                                        {availableWeeks.map(w => <option key={w} value={w}>{w === 'All' ? 'All' : `Week ${w}`}</option>)}
                                    </select>
                                </div>
                                <div className="filter-item toggle-item">
                                    <label>Active Only</label>
                                    <div
                                        className={`toggle-switch ${showOnlyActive ? 'on' : 'off'}`}
                                        onClick={() => setShowOnlyActive(!showOnlyActive)}
                                    >
                                        <div className="toggle-knob"></div>
                                    </div>
                                </div>
                                <div className="filter-item adjustment-controls" style={{ marginLeft: '12px', paddingLeft: '12px', borderLeft: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <label>Weekly Target</label>
                                    <input 
                                        type="number" 
                                        value={targetWeeklyHours} 
                                        onChange={(e) => setTargetWeeklyHours(e.target.value)}
                                        style={{ width: '60px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                    />
                                    <div className="mode-toggle" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ fontSize: '0.75rem', fontWeight: isAdjustedView ? 'normal' : 'bold' }}>Real</span>
                                        <div 
                                            className={`toggle-switch ${isAdjustedView ? 'on' : 'off'}`}
                                            onClick={() => setIsAdjustedView(!isAdjustedView)}
                                            title="Toggle Real vs Adjusted Hours"
                                        >
                                            <div className="toggle-knob"></div>
                                        </div>
                                        <span style={{ fontSize: '0.75rem', fontWeight: isAdjustedView ? 'bold' : 'normal', color: isAdjustedView ? 'var(--accent-color)' : 'inherit' }}>Adjusted</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="report-table-wrapper">
                        <table className="report-table">
                            <thead>
                                <tr>
                                    <th className="sticky-col">Employee Name</th>
                                    <th className="sticky-col-team">Team</th>
                                    {visibleDateColumns.map(date => {
                                        const d = new Date(date + 'T12:00:00');
                                        const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
                                        const holiday = getUSHoliday(date);
                                        const weekend = isWeekend(date);
                                        const tooltip = holiday ? `${weekday} - ${holiday}` : weekday;
                                        return (
                                            <th
                                                key={date}
                                                className={`date-col ${holiday ? 'is-holiday' : ''} ${weekend && !holiday ? 'is-weekend' : ''}`}
                                                title={tooltip}
                                            >
                                                {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                            </th>
                                        );
                                    })}
                                    <th className="text-right total-col">Total Hours</th>
                                </tr>
                            </thead>
                            <tbody>
                                {processedEmployees.length > 0 ? (
                                    processedEmployees.map((emp, index) => (
                                        <tr key={index} className={emp.isAdjusted && isAdjustedView ? 'adjusted-row' : ''}>
                                            <td className="sticky-col">{emp.name}</td>
                                            <td className="sticky-col-team">{emp.team}</td>
                                            {visibleDateColumns.map(date => {
                                                const d = new Date(date + 'T12:00:00');
                                                const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
                                                const holiday = getUSHoliday(date);
                                                const weekend = isWeekend(date);
                                                const tooltip = holiday ? `${weekday} - ${holiday}` : weekday;
                                                const rawVal = emp.dailyHours[date];
                                                return (
                                                    <td
                                                        key={date}
                                                        className={`text-center font-mono date-col ${holiday ? 'is-holiday' : ''} ${weekend && !holiday ? 'is-weekend' : ''} ${emp.isAdjusted && isAdjustedView && rawVal > 0 ? 'adjusted-cell' : ''}`}
                                                        title={tooltip}
                                                    >
                                                        {rawVal ? formatNum(rawVal) : '-'}
                                                    </td>
                                                );
                                            })}
                                            <td className={`text-right font-mono font-bold total-col ${emp.isAdjusted && isAdjustedView ? 'adjusted-total' : ''}`}>
                                                {formatNum(emp.total)}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={visibleDateColumns.length + 3} className="text-center">No results found matching your search.</td>
                                    </tr>
                                )}
                            </tbody>
                            {processedEmployees.length > 0 && (
                                <tfoot>
                                    <tr className="totals-row">
                                        <td className="sticky-col" colSpan="2">TOTALS</td>
                                        {visibleDateColumns.map(date => {
                                            const d = new Date(date + 'T12:00:00');
                                            const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
                                            const holiday = getUSHoliday(date);
                                            const weekend = isWeekend(date);
                                            const tooltip = holiday ? `${weekday} - ${holiday}` : weekday;
                                            return (
                                                <td
                                                    key={date}
                                                    className={`text-center font-mono font-bold date-col ${holiday ? 'is-holiday' : ''} ${weekend && !holiday ? 'is-weekend' : ''}`}
                                                    title={tooltip}
                                                >
                                                    {columnTotals[date] > 0 ? formatNum(columnTotals[date]) : '-'}
                                                </td>
                                            );
                                        })}
                                        <td className="text-right font-mono font-bold total-col">
                                            {formatNum(totalReportHours)}
                                        </td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>

                    <footer className="report-view-footer">
                        <p>Generated on {new Date().toLocaleString()}</p>
                        <p className="confidential-tag">Confidential Workforce Data</p>
                    </footer>
                </>
            )}
        </div>
    );
};

export default HoursReportView;
