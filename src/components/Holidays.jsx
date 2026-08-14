import React, { useState, useEffect, useMemo } from 'react';
import { CalendarX2, CalendarCheck2, CalendarCog } from 'lucide-react';
import './ScheduleBoard.css';
import './Holidays.css';
import BulkAddHolidaysModal from './BulkAddHolidaysModal';

// `color`/`textColor` here are only the fallback shown before Configuration >
// Scheduling > Holiday's saved chip colors load.
export const COUNTRIES = [
    { code: 'DO', name: 'Dominican Republic', flag: '🇩🇴', color: '#2563eb', textColor: '#ffffff' },
    { code: 'US', name: 'United States', flag: '🇺🇸', color: '#7c3aed', textColor: '#ffffff' }
];

// The 🇺🇸 emoji glyph renders as a blurry, hard-to-read smudge at the small
// sizes used here (Windows' emoji font has no crisp glyph at this scale) — an
// inline SVG stays sharp at any size, so it replaces the emoji wherever the
// flag is drawn visually. Text-only spots (title attributes, <option> labels)
// can't render an SVG and keep using the plain emoji from COUNTRIES.
const FlagUS = () => (
    <svg className="flag-icon-svg" viewBox="0 0 20 15" aria-hidden="true" focusable="false">
        <rect width="20" height="15" fill="#B22234" />
        <g fill="#FFFFFF">
            <rect y="1.15" width="20" height="1.15" />
            <rect y="3.46" width="20" height="1.15" />
            <rect y="5.77" width="20" height="1.15" />
            <rect y="8.08" width="20" height="1.15" />
            <rect y="10.38" width="20" height="1.15" />
            <rect y="12.69" width="20" height="1.15" />
        </g>
        <rect width="8" height="8.08" fill="#3C3B6E" />
    </svg>
);

export const FlagIcon = ({ country }) => (
    country.code === 'US' ? <FlagUS /> : <span>{country.flag}</span>
);

// Color + icon + badge are the three redundant signals for each type, so no one
// relies on color alone (accessibility requirement) — text/icon carry the meaning
// even for colorblind users or in monochrome print. `color` here is only the
// fallback shown before Configuration > Scheduling > Holiday's saved colors load.
export const HOLIDAY_TYPES = [
    {
        id: 'non_working',
        label: 'Non-Working Holiday',
        badge: 'Non-Working',
        description: 'Employees are not expected to work.',
        icon: CalendarX2,
        color: '#dc2626'
    },
    {
        id: 'working',
        label: 'Working Holiday',
        badge: 'Working',
        description: 'Employees work according to their normal schedule.',
        icon: CalendarCheck2,
        color: '#16a34a'
    },
    {
        // The id stays `campaign_defined`: it is the stored enum value in org_holidays,
        // org_team_holiday_types and org_holiday_type_colors, and renaming it would mean
        // migrating three tables for a label change. Only the wording is user-facing.
        id: 'campaign_defined',
        label: 'Custom',
        badge: 'Custom',
        description: 'Employees work, but a team can discount a time window from its scheduled hours.',
        icon: CalendarCog,
        color: '#eab308'
    }
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_HEADERS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const getCountry = (code, colorOverrides = {}) => {
    const base = COUNTRIES.find(c => c.code === code) || { code, name: code, flag: '🏳️', color: '#64748b', textColor: '#ffffff' };
    const override = colorOverrides[base.code];
    return override ? { ...base, color: override.color, textColor: override.text_color } : base;
};

// Picks readable text (dark navy or white) for a given background color, so an
// admin can pick any Holiday Type color in Settings without also having to pick
// a matching text color. YIQ formula, threshold matches this app's existing badges.
export const getContrastTextColor = (hex) => {
    const clean = (hex || '').replace('#', '');
    if (clean.length !== 6) return '#ffffff';
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? '#1b2d46' : '#ffffff';
};

const getHolidayType = (id, colorOverrides = {}) => {
    const base = HOLIDAY_TYPES.find(t => t.id === id) || HOLIDAY_TYPES[0];
    const color = colorOverrides[base.id] || base.color;
    return { ...base, color, textColor: getContrastTextColor(color) };
};

const HolidayTypeBadge = ({ typeId, colorOverrides }) => {
    const type = getHolidayType(typeId, colorOverrides);
    const Icon = type.icon;
    return (
        <span className="holiday-type-badge2" style={{ '--badge-bg': type.color, '--badge-text': type.textColor }}>
            <Icon size={13} strokeWidth={2.25} />
            {type.badge}
        </span>
    );
};

const getMonday = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
};

const getWeekDates = (monday) => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split('T')[0];
});

const formatDateLabel = (dateStr) => new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

// Holiday names and descriptions are free text, so a bare join(',') would split a
// single cell in two the moment someone types a comma. Quote every field and double
// any inner quote, per RFC 4180.
const escapeCsvValue = (value) => `"${(value ?? '').toString().replace(/"/g, '""')}"`;

const buildHolidayTooltip = (holiday) => {
    const country = getCountry(holiday.country_code);
    const type = getHolidayType(holiday.holiday_type);
    const lines = [
        holiday.name,
        formatDateLabel(holiday.holiday_date),
        `${country.flag} ${country.name}`,
        type.label
    ];
    if (holiday.description) lines.push(holiday.description);
    return lines.join('\n');
};

const todayStr = new Date().toISOString().split('T')[0];

const emptyForm = (dateStr) => ({
    id: null,
    name: '',
    holiday_date: dateStr || todayStr,
    country_code: 'DO',
    holiday_type: 'non_working',
    description: ''
});

const Holidays = () => {
    const [holidays, setHolidays] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [typeColors, setTypeColors] = useState({});
    const [countryColors, setCountryColors] = useState({});

    const [viewMode, setViewMode] = useState('month');
    const [anchorDate, setAnchorDate] = useState(new Date());

    const [searchTerm, setSearchTerm] = useState('');
    const [countryFilter, setCountryFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [monthFilter, setMonthFilter] = useState('all');
    const [yearFilter, setYearFilter] = useState('all');

    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState(emptyForm());
    const [formError, setFormError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [bulkModalOpen, setBulkModalOpen] = useState(false);

    const loadHolidays = () => {
        setLoading(true);
        fetch('./api/get_holidays.php')
            .then(res => res.json())
            .then(json => {
                if (json.success) {
                    setHolidays(json.holidays || []);
                    setError(null);
                } else {
                    setError(json.error || 'Failed to load holidays.');
                }
            })
            .catch(() => setError('Failed to load holidays.'))
            .finally(() => setLoading(false));
    };

    useEffect(() => { loadHolidays(); }, []);

    useEffect(() => {
        fetch('./api/manage_holiday_type_colors.php')
            .then(res => res.json())
            .then(json => {
                if (json.success) {
                    const map = {};
                    (json.colors || []).forEach(c => { map[c.holiday_type] = c.color; });
                    setTypeColors(map);
                }
            })
            .catch(() => {});

        fetch('./api/manage_holiday_country_colors.php')
            .then(res => res.json())
            .then(json => {
                if (json.success) {
                    const map = {};
                    (json.colors || []).forEach(c => { map[c.country_code] = { color: c.color, text_color: c.text_color }; });
                    setCountryColors(map);
                }
            })
            .catch(() => {});
    }, []);

    const filteredHolidays = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        return holidays.filter(h => {
            if (term && !h.name.toLowerCase().includes(term)) return false;
            if (countryFilter !== 'all' && h.country_code !== countryFilter) return false;
            if (typeFilter !== 'all' && h.holiday_type !== typeFilter) return false;
            const d = new Date(h.holiday_date + 'T12:00:00');
            if (monthFilter !== 'all' && (d.getMonth() + 1) !== Number(monthFilter)) return false;
            if (yearFilter !== 'all' && d.getFullYear() !== Number(yearFilter)) return false;
            return true;
        }).sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
    }, [holidays, searchTerm, countryFilter, typeFilter, monthFilter, yearFilter]);

    const holidaysByDate = useMemo(() => {
        const map = {};
        filteredHolidays.forEach(h => {
            (map[h.holiday_date] = map[h.holiday_date] || []).push(h);
        });
        return map;
    }, [filteredHolidays]);

    const hasActiveFilters = searchTerm.trim() !== '' || countryFilter !== 'all'
        || typeFilter !== 'all' || monthFilter !== 'all' || yearFilter !== 'all';

    // Exports exactly the rows the List view is showing: it reads filteredHolidays,
    // the same array the table renders, so any active filter carries over untouched.
    const handleExportList = () => {
        // Column names and value formats match what Bulk Add Holidays' importer accepts
        // (HEADER_ALIASES / resolveDate / resolveCountryCode / resolveHolidayType), so an
        // exported list can be fed straight back in. "Holiday Name" and the full type
        // label are required for that — "Holiday" and "Non-Working" do not resolve.
        const headers = ['Date', 'Holiday Name', 'Country', 'Type', 'Description'];
        const rows = filteredHolidays.map(h => [
            // ISO rather than the on-screen label so Excel reads it as a date and sorts it.
            h.holiday_date,
            h.name,
            getCountry(h.country_code).name,
            getHolidayType(h.holiday_type).label,
            h.description || ''
        ]);

        // Leading BOM, otherwise Excel opens the file as ANSI and mangles the accents
        // in Spanish holiday names.
        const csv = '\uFEFF' + [headers, ...rows]
            .map(row => row.map(escapeCsvValue).join(','))
            .join('\r\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `Holidays_List_${todayStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const availableYears = useMemo(() => {
        const years = new Set(holidays.map(h => new Date(h.holiday_date + 'T12:00:00').getFullYear()));
        years.add(new Date().getFullYear());
        return Array.from(years).sort((a, b) => a - b);
    }, [holidays]);

    const navigatePeriod = (direction) => {
        const d = new Date(anchorDate);
        if (viewMode === 'week') {
            d.setDate(d.getDate() + direction * 7);
        } else {
            d.setMonth(d.getMonth() + direction);
        }
        setAnchorDate(d);
    };

    const openAddModal = (dateStr) => {
        setForm(emptyForm(dateStr));
        setFormError(null);
        setModalOpen(true);
    };

    const openEditModal = (holiday) => {
        setForm({
            id: holiday.id,
            name: holiday.name,
            holiday_date: holiday.holiday_date,
            country_code: holiday.country_code,
            holiday_type: holiday.holiday_type,
            description: holiday.description || ''
        });
        setFormError(null);
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setFormError(null);
    };

    const hasClientDuplicate = () => holidays.some(h =>
        h.id !== form.id &&
        h.country_code === form.country_code &&
        h.holiday_date === form.holiday_date
    );

    const handleSave = async () => {
        if (!form.name.trim()) {
            setFormError('Holiday name is required.');
            return;
        }
        if (!form.holiday_date) {
            setFormError('A date is required.');
            return;
        }
        if (hasClientDuplicate()) {
            setFormError('A holiday already exists for that country on that date.');
            return;
        }

        setSaving(true);
        setFormError(null);
        try {
            const res = await fetch('./api/manage_holidays.php', {
                method: form.id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form)
            });
            const json = await res.json();
            if (json.success) {
                closeModal();
                loadHolidays();
            } else {
                setFormError(json.error || 'Failed to save holiday.');
            }
        } catch (err) {
            setFormError('Failed to save holiday.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!form.id) return;
        if (!window.confirm(`Delete "${form.name}"? This cannot be undone.`)) return;

        setDeleting(true);
        try {
            const res = await fetch(`./api/manage_holidays.php?id=${form.id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.success) {
                closeModal();
                loadHolidays();
            } else {
                setFormError(json.error || 'Failed to delete holiday.');
            }
        } catch (err) {
            setFormError('Failed to delete holiday.');
        } finally {
            setDeleting(false);
        }
    };

    const renderHolidayChip = (holiday) => {
        const country = getCountry(holiday.country_code, countryColors);
        const type = getHolidayType(holiday.holiday_type, typeColors);
        return (
            <button
                key={holiday.id}
                type="button"
                className="holiday-chip"
                style={{ '--chip-bg': country.color, '--chip-text': country.textColor }}
                onClick={(e) => { e.stopPropagation(); openEditModal(holiday); }}
                title={buildHolidayTooltip(holiday)}
            >
                <span className="holiday-chip-flag"><FlagIcon country={country} /></span>
                <span className="holiday-chip-name">{holiday.name}</span>
                <span className="holiday-chip-indicator" style={{ '--indicator-color': type.color }} />
            </button>
        );
    };

    const renderMonthView = () => {
        const year = anchorDate.getFullYear();
        const month = anchorDate.getMonth();
        const firstOfMonth = new Date(year, month, 1);
        const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const cells = [];
        for (let i = 0; i < firstWeekday; i++) cells.push(null);
        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(year, month, day);
            cells.push(d.toISOString().split('T')[0]);
        }
        while (cells.length % 7 !== 0) cells.push(null);
        const weekCount = cells.length / 7;

        return (
            <div className="holiday-calendar-grid" style={{ '--week-count': weekCount }}>
                {WEEKDAY_HEADERS.map(w => <div key={w} className="holiday-calendar-weekday-header">{w}</div>)}
                {cells.map((dateStr, idx) => {
                    if (!dateStr) return <div key={`blank-${idx}`} className="holiday-calendar-cell is-empty-cell" />;
                    const dayHolidays = holidaysByDate[dateStr] || [];
                    const dayNum = parseInt(dateStr.split('-')[2], 10);
                    return (
                        <div
                            key={dateStr}
                            className={`holiday-calendar-cell ${dateStr === todayStr ? 'is-today' : ''}`}
                            onClick={() => openAddModal(dateStr)}
                            title="Click to add a holiday on this day"
                        >
                            <span className="holiday-calendar-day-number">{dayNum}</span>
                            <div className="holiday-calendar-day-chips">
                                {dayHolidays.map(renderHolidayChip)}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderWeekView = () => {
        const weekDates = getWeekDates(getMonday(anchorDate));
        return (
            <div className="holiday-week-grid">
                {weekDates.map(dateStr => {
                    const dayHolidays = holidaysByDate[dateStr] || [];
                    const dObj = new Date(dateStr + 'T12:00:00');
                    return (
                        <div
                            key={dateStr}
                            className={`holiday-week-cell ${dateStr === todayStr ? 'is-today' : ''}`}
                            onClick={() => openAddModal(dateStr)}
                            title="Click to add a holiday on this day"
                        >
                            <div className="holiday-week-cell-header">
                                <span className="holiday-week-day-name">{dObj.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                                <span className="holiday-week-day-number">{dObj.getDate()}</span>
                            </div>
                            <div className="holiday-week-cell-chips">
                                {dayHolidays.length === 0 ? (
                                    <span className="holiday-week-empty">—</span>
                                ) : dayHolidays.map(renderHolidayChip)}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderListView = () => (
        <div className="holiday-list-wrapper">
            {filteredHolidays.length === 0 ? (
                <div className="report-empty-state">No holidays match the current filters.</div>
            ) : (
                <table className="holiday-list-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Holiday</th>
                            <th>Country</th>
                            <th>Type</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredHolidays.map(h => {
                            const country = getCountry(h.country_code);
                            return (
                                <tr key={h.id} className="clickable-row" onClick={() => openEditModal(h)} title={buildHolidayTooltip(h)}>
                                    <td>{formatDateLabel(h.holiday_date)}</td>
                                    <td className="holiday-list-name">{h.name}</td>
                                    <td>
                                        <span className="holiday-country-tag"><FlagIcon country={country} /> {country.name}</span>
                                    </td>
                                    <td><HolidayTypeBadge typeId={h.holiday_type} colorOverrides={typeColors} /></td>
                                    <td className="holiday-list-description">{h.description || '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </div>
    );

    return (
        <div className="schedule-board-container holidays-container">
            <header className="board-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1>Scheduling</h1>
                        <span className="badge">Holidays</span>
                    </div>
                    <div className="week-range-label">
                        Manage the company holiday calendar used by Forecast and Run Rate calculations.
                    </div>
                </div>
                <div className="holiday-add-split">
                    <button className="holiday-add-btn holiday-add-btn-main" onClick={() => openAddModal(todayStr)}>+ Add Holiday</button>
                    <button
                        className="holiday-add-btn holiday-add-btn-caret"
                        onClick={() => setAddMenuOpen(o => !o)}
                        title="More add options"
                    >
                        ▾
                    </button>
                    {addMenuOpen && (
                        <>
                            <div className="dropdown-overlay" onClick={() => setAddMenuOpen(false)} />
                            <div className="dropdown-menu holiday-add-menu">
                                <button
                                    className="view-toggle-option"
                                    onClick={() => { openAddModal(todayStr); setAddMenuOpen(false); }}
                                >
                                    <span className="view-toggle-label">Add Holiday</span>
                                </button>
                                <button
                                    className="view-toggle-option"
                                    onClick={() => { setBulkModalOpen(true); setAddMenuOpen(false); }}
                                >
                                    <span className="view-toggle-label">Bulk Add Holidays</span>
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </header>

            <div className="holiday-toolbar">
                <div className="search-box holiday-search-box">
                    <span className="search-icon">🔍</span>
                    <input
                        type="text"
                        placeholder="Search holiday name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <select className="holiday-filter-select" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
                    <option value="all">All Countries</option>
                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
                </select>

                <select className="holiday-filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                    <option value="all">All Types</option>
                    {HOLIDAY_TYPES.map(t => <option key={t.id} value={t.id}>{t.badge}</option>)}
                </select>

                <select className="holiday-filter-select" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                    <option value="all">All Months</option>
                    {MONTH_NAMES.map((m, idx) => <option key={m} value={idx + 1}>{m}</option>)}
                </select>

                <select className="holiday-filter-select" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                    <option value="all">All Years</option>
                    {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                <div className="holiday-view-toggle navigation-controls">
                    <button className={`nav-btn ${viewMode === 'month' ? 'today' : ''}`} onClick={() => setViewMode('month')}>Month</button>
                    <button className={`nav-btn ${viewMode === 'week' ? 'today' : ''}`} onClick={() => setViewMode('week')}>Week</button>
                    <button className={`nav-btn ${viewMode === 'list' ? 'today' : ''}`} onClick={() => setViewMode('list')}>List</button>
                </div>
            </div>

            {viewMode !== 'list' && (
                <div className="holiday-period-nav navigation-controls">
                    <button className="nav-btn prev" onClick={() => navigatePeriod(-1)} title={`Previous ${viewMode}`}>←</button>
                    <button className="nav-btn today" onClick={() => setAnchorDate(new Date())}>Today</button>
                    <button className="nav-btn next" onClick={() => navigatePeriod(1)} title={`Next ${viewMode}`}>→</button>
                    <span className="holiday-period-label">
                        {viewMode === 'month'
                            ? `${MONTH_NAMES[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`
                            : `Week of ${formatDateLabel(getWeekDates(getMonday(anchorDate))[0])}`}
                    </span>
                </div>
            )}

            {viewMode === 'list' && (
                <div className="holiday-period-nav holiday-list-actions">
                    <span className="holiday-period-label">
                        {filteredHolidays.length === holidays.length
                            ? `${filteredHolidays.length} holidays`
                            : `${filteredHolidays.length} of ${holidays.length} holidays`}
                        {hasActiveFilters && <span className="holiday-filtered-tag">filtered</span>}
                    </span>
                    <button
                        className="holiday-add-btn holiday-export-btn"
                        onClick={handleExportList}
                        disabled={filteredHolidays.length === 0}
                        title="Download the rows currently listed, with the active filters applied"
                    >
                        Export
                    </button>
                </div>
            )}

            <div className="board-main-area holiday-main-area">
                {loading ? (
                    <div className="report-empty-state">Loading holidays...</div>
                ) : error ? (
                    <div className="report-empty-state">⚠️ {error}</div>
                ) : viewMode === 'month' ? renderMonthView() : viewMode === 'week' ? renderWeekView() : renderListView()}
            </div>

            {modalOpen && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-content holiday-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{form.id ? 'Edit Holiday' : 'Add Holiday'}</h2>
                            <button className="close-btn" onClick={closeModal}>&times;</button>
                        </div>

                        <div className="modal-body">
                            <div className="form-group full-width-group">
                                <label>Holiday Name</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g. Independence Day"
                                />
                            </div>

                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Date</label>
                                    <input
                                        type="date"
                                        value={form.holiday_date}
                                        onChange={(e) => setForm(f => ({ ...f, holiday_date: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Country</label>
                                    <select
                                        value={form.country_code}
                                        onChange={(e) => setForm(f => ({ ...f, country_code: e.target.value }))}
                                    >
                                        {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="form-group full-width-group">
                                <label>Holiday Type</label>
                                <select
                                    value={form.holiday_type}
                                    onChange={(e) => setForm(f => ({ ...f, holiday_type: e.target.value }))}
                                >
                                    {HOLIDAY_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </select>
                                <span className="holiday-type-hint">{getHolidayType(form.holiday_type).description}</span>
                            </div>

                            <div className="form-group full-width-group">
                                <label>Description (optional)</label>
                                <textarea
                                    rows={3}
                                    value={form.description}
                                    onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder="Notes about this holiday..."
                                />
                            </div>

                            {formError && <p className="forecast-error">{formError}</p>}
                        </div>

                        <div className="modal-footer holiday-modal-footer">
                            {form.id && (
                                <button className="holiday-delete-btn" onClick={handleDelete} disabled={deleting || saving}>
                                    {deleting ? 'Deleting...' : 'Delete'}
                                </button>
                            )}
                            <div className="holiday-modal-footer-right">
                                <button className="btn-cancel" onClick={closeModal}>Cancel</button>
                                <button className="btn-confirm" onClick={handleSave} disabled={saving || deleting}>
                                    {saving ? 'Saving...' : form.id ? 'Save Changes' : 'Create Holiday'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {bulkModalOpen && (
                <BulkAddHolidaysModal
                    existingHolidays={holidays}
                    onClose={() => setBulkModalOpen(false)}
                    onSaved={loadHolidays}
                />
            )}
        </div>
    );
};

export default Holidays;
