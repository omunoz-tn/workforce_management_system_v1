import React, { useState, useEffect } from 'react';
import './ScheduleBoard.css';
import './ScheduleForecastSettings.css';
import './HolidayColorSettings.css';
import './Holidays.css';
import { HOLIDAY_TYPES, COUNTRIES, getContrastTextColor, FlagIcon } from './Holidays';

const buildTypeColorMap = () => {
    const map = {};
    HOLIDAY_TYPES.forEach(t => { map[t.id] = t.color; });
    return map;
};

const buildCountryColorMap = () => {
    const map = {};
    COUNTRIES.forEach(c => { map[c.code] = { color: c.color, text_color: c.textColor }; });
    return map;
};

const HolidayColorSettings = ({ activeTab, onTabChange }) => {
    const [colors, setColors] = useState(buildTypeColorMap);
    const [loading, setLoading] = useState(true);
    const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
    const [saveError, setSaveError] = useState(null);

    const [countryColors, setCountryColors] = useState(buildCountryColorMap);
    const [countryLoading, setCountryLoading] = useState(true);
    const [countrySaveStatus, setCountrySaveStatus] = useState(null);
    const [countrySaveError, setCountrySaveError] = useState(null);

    useEffect(() => {
        fetch('./api/manage_holiday_type_colors.php')
            .then(res => res.json())
            .then(json => {
                if (json.success) {
                    setColors(prev => {
                        const next = { ...prev };
                        (json.colors || []).forEach(c => { next[c.holiday_type] = c.color; });
                        return next;
                    });
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));

        fetch('./api/manage_holiday_country_colors.php')
            .then(res => res.json())
            .then(json => {
                if (json.success) {
                    setCountryColors(prev => {
                        const next = { ...prev };
                        (json.colors || []).forEach(c => { next[c.country_code] = { color: c.color, text_color: c.text_color }; });
                        return next;
                    });
                }
            })
            .catch(() => {})
            .finally(() => setCountryLoading(false));
    }, []);

    const handleColorChange = (typeId, value) => {
        setColors(prev => ({ ...prev, [typeId]: value }));
        setSaveStatus(null);
    };

    const handleSave = async () => {
        setSaveStatus('saving');
        setSaveError(null);
        try {
            const res = await fetch('./api/manage_holiday_type_colors.php', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    colors: HOLIDAY_TYPES.map(t => ({ holiday_type: t.id, color: colors[t.id] }))
                })
            });
            const json = await res.json();
            if (json.success) {
                setSaveStatus('saved');
            } else {
                setSaveStatus('error');
                setSaveError(json.error || 'Failed to save.');
            }
        } catch (err) {
            setSaveStatus('error');
            setSaveError('Failed to save.');
        }
    };

    const handleCountryColorChange = (code, field, value) => {
        setCountryColors(prev => ({ ...prev, [code]: { ...prev[code], [field]: value } }));
        setCountrySaveStatus(null);
    };

    const handleCountrySave = async () => {
        setCountrySaveStatus('saving');
        setCountrySaveError(null);
        try {
            const res = await fetch('./api/manage_holiday_country_colors.php', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    colors: COUNTRIES.map(c => ({
                        country_code: c.code,
                        color: countryColors[c.code].color,
                        text_color: countryColors[c.code].text_color
                    }))
                })
            });
            const json = await res.json();
            if (json.success) {
                setCountrySaveStatus('saved');
            } else {
                setCountrySaveStatus('error');
                setCountrySaveError(json.error || 'Failed to save.');
            }
        } catch (err) {
            setCountrySaveStatus('error');
            setCountrySaveError('Failed to save.');
        }
    };

    return (
        <div className="schedule-board-container">
            <header className="board-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1>Scheduling</h1>
                        <span className="badge">Holiday</span>
                    </div>
                    <div className="week-range-label">
                        Choose the color used for each Holiday Type across the Holidays calendar.
                    </div>
                </div>
                <div className="settings-tab-toggle navigation-controls">
                    <button
                        type="button"
                        className={`nav-btn ${activeTab === 'forecast' ? 'today' : ''}`}
                        onClick={() => onTabChange('forecast')}
                    >
                        Forecast Source
                    </button>
                    <button
                        type="button"
                        className={`nav-btn ${activeTab === 'holidays' ? 'today' : ''}`}
                        onClick={() => onTabChange('holidays')}
                    >
                        Holiday
                    </button>
                </div>
            </header>

            <div className="forecast-settings-scroll">
                <section className="forecast-settings-section">
                    <h2>Holiday Type Colors</h2>
                    <p className="section-desc">
                        One color per Holiday Type. It's used for the indicator on each holiday's chip in the
                        calendar and for the Type badge in the List view — the text color adjusts automatically
                        to stay readable.
                    </p>

                    {loading ? (
                        <p className="section-desc">Loading colors...</p>
                    ) : (
                        <div className="holiday-color-list">
                            {HOLIDAY_TYPES.map(type => {
                                const Icon = type.icon;
                                const color = colors[type.id];
                                const textColor = getContrastTextColor(color);
                                return (
                                    <div key={type.id} className="holiday-color-row">
                                        <div className="holiday-color-row-label">
                                            <Icon size={16} strokeWidth={2.25} />
                                            <span>{type.label}</span>
                                        </div>

                                        <div className="holiday-color-previews">
                                            {COUNTRIES.map(country => {
                                                const countryEntry = countryColors[country.code] || { color: country.color, text_color: country.textColor };
                                                return (
                                                    <span
                                                        key={country.code}
                                                        className="holiday-chip"
                                                        style={{ background: countryEntry.color, color: countryEntry.text_color, width: 'auto', cursor: 'default' }}
                                                    >
                                                        <span className="holiday-chip-flag"><FlagIcon country={country} /></span>
                                                        <span className="holiday-chip-name">Holiday name</span>
                                                        <span className="holiday-chip-indicator" style={{ background: color }} />
                                                    </span>
                                                );
                                            })}
                                            <span className="holiday-type-badge2" style={{ background: color, color: textColor }}>
                                                <Icon size={13} strokeWidth={2.25} />
                                                {type.badge}
                                            </span>
                                        </div>

                                        <div className="holiday-color-inputs">
                                            <input
                                                type="color"
                                                value={color}
                                                onChange={(e) => handleColorChange(type.id, e.target.value)}
                                            />
                                            <input
                                                type="text"
                                                className="holiday-color-hex"
                                                value={color}
                                                onChange={(e) => handleColorChange(type.id, e.target.value)}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="holiday-color-save-bar">
                        <button
                            className="holiday-color-save-btn"
                            onClick={handleSave}
                            disabled={loading || saveStatus === 'saving'}
                        >
                            {saveStatus === 'saving' ? 'Saving...' : 'Save Changes'}
                        </button>
                        {saveStatus === 'saved' && <span className="holiday-color-status success">Saved.</span>}
                        {saveStatus === 'error' && <span className="holiday-color-status error">{saveError}</span>}
                    </div>
                </section>

                <section className="forecast-settings-section">
                    <h2>Country Chip Colors</h2>
                    <p className="section-desc">
                        Chip background and text color per country — e.g. a US holiday's chip can look
                        different from a Dominican Republic holiday's chip.
                    </p>

                    {countryLoading ? (
                        <p className="section-desc">Loading colors...</p>
                    ) : (
                        <div className="holiday-color-list">
                            {COUNTRIES.map(country => {
                                const entry = countryColors[country.code];
                                return (
                                    <div key={country.code} className="holiday-color-row">
                                        <div className="holiday-color-row-label">
                                            <span><FlagIcon country={country} /></span>
                                            <span>{country.name}</span>
                                        </div>

                                        <div className="holiday-color-previews">
                                            <span
                                                className="holiday-chip"
                                                style={{ background: entry.color, color: entry.text_color, width: 'auto', cursor: 'default' }}
                                            >
                                                <span className="holiday-chip-flag"><FlagIcon country={country} /></span>
                                                <span className="holiday-chip-name">Holiday name</span>
                                                <span className="holiday-chip-indicator" style={{ background: 'rgba(255,255,255,0.45)' }} />
                                            </span>
                                        </div>

                                        <div className="holiday-color-inputs">
                                            <label className="holiday-color-input-label">
                                                Chip
                                                <input
                                                    type="color"
                                                    value={entry.color}
                                                    onChange={(e) => handleCountryColorChange(country.code, 'color', e.target.value)}
                                                />
                                            </label>
                                            <label className="holiday-color-input-label">
                                                Text
                                                <input
                                                    type="color"
                                                    value={entry.text_color}
                                                    onChange={(e) => handleCountryColorChange(country.code, 'text_color', e.target.value)}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="holiday-color-save-bar">
                        <button
                            className="holiday-color-save-btn"
                            onClick={handleCountrySave}
                            disabled={countryLoading || countrySaveStatus === 'saving'}
                        >
                            {countrySaveStatus === 'saving' ? 'Saving...' : 'Save Changes'}
                        </button>
                        {countrySaveStatus === 'saved' && <span className="holiday-color-status success">Saved.</span>}
                        {countrySaveStatus === 'error' && <span className="holiday-color-status error">{countrySaveError}</span>}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default HolidayColorSettings;
