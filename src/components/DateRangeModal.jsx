import React, { useState } from 'react';
import './DateRangeModal.css';

const DateRangeModal = ({ isOpen, onClose, onConfirm }) => {
    const today = new Date().toISOString().split('T')[0];
    const [fromDate, setFromDate] = useState(today);
    const [toDate, setToDate] = useState(today);
    const [selectedWeek, setSelectedWeek] = useState('');

    // Helper: Generate the last 12 weeks (Monday to Sunday)
    const getRecentWeeks = () => {
        const weeks = [];
        const now = new Date();
        
        // Find current Monday
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
            // Monday of last week
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

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content date-range-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Select Date Range</h2>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    <p className="modal-intro">
                        Quickly select a week or specify a custom date range.
                    </p>

                    <div className="form-group full-width-group">
                        <label>Quick Select Range</label>
                        <select className="week-select" value={selectedWeek} onChange={handleQuickSelect}>
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
                            />
                        </div>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn-cancel" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="btn-confirm"
                        onClick={() => onConfirm(fromDate, toDate)}
                    >
                        Generate Report
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DateRangeModal;
