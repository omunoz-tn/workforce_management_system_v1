import React, { useState, useEffect } from 'react';
import './ReportSettings.css';
import RunRateExceptionsModal from './RunRateExceptionsModal';

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

// Reports that currently expose advanced, per-team configuration options.
const ADVANCED_REPORTS = ['run-rate'];

const TIME_SOURCE_OPTIONS = [
    { value: 'desktime_time', label: 'Desktime Time (Total Tracked)' },
    { value: 'at_work_time', label: 'At Work Time' }
];

const BLANK_RANGE_DRAFT = { id: null, start: '', color: '#99C24D', blink: false };

const ReportSettings = () => {
    const [visibleReports, setVisibleReports] = useState(REPORTS.map(r => r.id));
    const [advancedReportId, setAdvancedReportId] = useState('');
    const [teams, setTeams] = useState([]);
    const [pendingChanges, setPendingChanges] = useState({});
    const [loadingTeams, setLoadingTeams] = useState(false);
    const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

    const [colorRanges, setColorRanges] = useState([]);
    const [loadingRanges, setLoadingRanges] = useState(false);
    const [rangeDraft, setRangeDraft] = useState(BLANK_RANGE_DRAFT);
    const [rangeSaveStatus, setRangeSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
    const [rangeError, setRangeError] = useState(null);

    const [exceptionsTeam, setExceptionsTeam] = useState(null);

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

    const loadTeams = async () => {
        setLoadingTeams(true);
        setSaveStatus(null);
        try {
            const res = await fetch('./api/manage_report_settings.php');
            const json = await res.json();
            if (json.success) {
                setTeams(json.teams || []);
                setPendingChanges({});
            }
        } catch (err) {
            console.error('Failed to load report settings', err);
        } finally {
            setLoadingTeams(false);
        }
    };

    const loadColorRanges = async () => {
        setLoadingRanges(true);
        setRangeSaveStatus(null);
        setRangeError(null);
        try {
            const res = await fetch('./api/manage_run_rate_ranges.php');
            const json = await res.json();
            if (json.success) {
                setColorRanges(json.ranges || []);
            }
        } catch (err) {
            console.error('Failed to load run rate color ranges', err);
        } finally {
            setLoadingRanges(false);
        }
    };

    const handleSelectAdvancedReport = (reportId) => {
        setAdvancedReportId(reportId);
        setSaveStatus(null);
        if (reportId === 'run-rate') {
            loadTeams();
            loadColorRanges();
            setRangeDraft(BLANK_RANGE_DRAFT);
        }
    };

    const handleTimeSourceChange = (teamId, value) => {
        setPendingChanges(prev => ({ ...prev, [teamId]: value }));
    };

    const handleSaveAdvancedConfig = async () => {
        const updates = Object.entries(pendingChanges).map(([team_id, run_rate_time_source]) => ({
            team_id: Number(team_id),
            run_rate_time_source
        }));

        if (updates.length === 0) return;

        setSaveStatus('saving');
        try {
            const res = await fetch('./api/manage_report_settings.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates })
            });
            const json = await res.json();
            if (json.success) {
                setSaveStatus('saved');
                loadTeams();
            } else {
                setSaveStatus('error');
            }
        } catch (err) {
            console.error('Failed to save report settings', err);
            setSaveStatus('error');
        }
    };

    const handleSelectRangeForEdit = (range) => {
        setRangeError(null);
        setRangeSaveStatus(null);
        setRangeDraft({
            id: range.id,
            start: String(range.range_start),
            color: range.color,
            blink: !!Number(range.is_blinking)
        });
    };

    const handleCancelRangeEdit = () => {
        setRangeDraft(BLANK_RANGE_DRAFT);
        setRangeError(null);
        setRangeSaveStatus(null);
    };

    const handleSaveRange = async () => {
        setRangeError(null);

        if (rangeDraft.start === '' || isNaN(Number(rangeDraft.start))) {
            setRangeError('Enter a starting percentage.');
            return;
        }
        if (!/^#[0-9A-Fa-f]{6}$/.test(rangeDraft.color)) {
            setRangeError('Pick a valid color.');
            return;
        }

        setRangeSaveStatus('saving');
        try {
            const res = await fetch('./api/manage_run_rate_ranges.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: rangeDraft.id,
                    range_start: Number(rangeDraft.start),
                    color: rangeDraft.color,
                    is_blinking: rangeDraft.blink
                })
            });
            const json = await res.json();
            if (json.success) {
                setRangeSaveStatus('saved');
                setRangeDraft(BLANK_RANGE_DRAFT);
                loadColorRanges();
            } else {
                setRangeSaveStatus('error');
                setRangeError(json.error || 'Failed to save.');
            }
        } catch (err) {
            console.error('Failed to save run rate color range', err);
            setRangeSaveStatus('error');
            setRangeError('Failed to save.');
        }
    };

    const handleRemoveRange = async (range) => {
        if (!window.confirm(`Remove the ${range.range_start}% and above range?`)) {
            return;
        }
        try {
            const res = await fetch(`./api/manage_run_rate_ranges.php?id=${range.id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.success) {
                if (rangeDraft.id === range.id) setRangeDraft(BLANK_RANGE_DRAFT);
                loadColorRanges();
            }
        } catch (err) {
            console.error('Failed to remove run rate color range', err);
        }
    };

    const sortedColorRanges = [...colorRanges].sort((a, b) => Number(b.range_start) - Number(a.range_start));

    const groupedTeams = teams.reduce((acc, team) => {
        const group = team.group_name || 'Unassigned';
        if (!acc[group]) acc[group] = [];
        acc[group].push(team);
        return acc;
    }, {});

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

            <section className="settings-section">
                <h2>Advance Configuration</h2>
                <p className="section-desc">Select a report to configure advanced, per-team calculation options.</p>

                <select
                    className="advance-config-select"
                    value={advancedReportId}
                    onChange={(e) => handleSelectAdvancedReport(e.target.value)}
                >
                    <option value="">Select a report...</option>
                    {REPORTS.map(report => (
                        <option key={report.id} value={report.id}>{report.icon} {report.label}</option>
                    ))}
                </select>

                {advancedReportId && !ADVANCED_REPORTS.includes(advancedReportId) && (
                    <p className="advance-config-empty">No advanced options available for this report.</p>
                )}

                {advancedReportId === 'run-rate' && (
                    <div className="advance-config-panel">
                        <p className="section-desc">
                            Choose which DeskTime field each team's Run Rate should be calculated with.
                        </p>

                        {loadingTeams ? (
                            <p className="advance-config-empty">Loading teams...</p>
                        ) : (
                            <>
                                {Object.entries(groupedTeams).map(([groupName, groupTeams]) => (
                                    <div key={groupName} className="advance-config-group">
                                        <h3 className="advance-config-group-title">{groupName}</h3>
                                        <div className="advance-config-team-list">
                                            {groupTeams.map(team => (
                                                <div key={team.id} className="advance-config-team-row">
                                                    <span className="advance-config-team-name">{team.name}</span>
                                                    <button
                                                        type="button"
                                                        className="advance-config-drilldown-btn"
                                                        onClick={() => setExceptionsTeam(team)}
                                                        title={`Manage Run Rate exceptions for ${team.name}`}
                                                    >
                                                        👥 Employees Exceptions
                                                    </button>
                                                    <select
                                                        value={pendingChanges[team.id] ?? team.run_rate_time_source}
                                                        onChange={(e) => handleTimeSourceChange(team.id, e.target.value)}
                                                    >
                                                        {TIME_SOURCE_OPTIONS.map(opt => (
                                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}

                                <div className="advance-config-save-bar">
                                    <button
                                        className="advance-config-save-btn"
                                        onClick={handleSaveAdvancedConfig}
                                        disabled={Object.keys(pendingChanges).length === 0 || saveStatus === 'saving'}
                                    >
                                        {saveStatus === 'saving' ? 'Saving...' : 'Save Changes'}
                                    </button>
                                    {saveStatus === 'saved' && <span className="advance-config-status success">Saved.</span>}
                                    {saveStatus === 'error' && <span className="advance-config-status error">Failed to save. Try again.</span>}
                                </div>
                            </>
                        )}

                        <div className="range-config-divider" />

                        <div className="range-config-section">
                            <h3 className="advance-config-group-title">Run Rate Color Ranges</h3>
                            <p className="section-desc">
                                Set the percentage where each color band starts. A band applies from its starting
                                percentage up to the next band above it — the highest band has no upper limit.
                            </p>

                            {loadingRanges ? (
                                <p className="advance-config-empty">Loading ranges...</p>
                            ) : colorRanges.length === 0 ? (
                                <p className="advance-config-empty">
                                    No custom ranges configured — reports are using the default thresholds (98% / 95% / 91%).
                                </p>
                            ) : (
                                <div className="range-list">
                                    {sortedColorRanges.map(range => (
                                        <div
                                            key={range.id}
                                            className={`range-row ${rangeDraft.id === range.id ? 'is-editing' : ''}`}
                                            onClick={() => handleSelectRangeForEdit(range)}
                                        >
                                            <span className="range-swatch" style={{ background: range.color }} />
                                            <span className="range-row-label">{Number(range.range_start)}% and above</span>
                                            {!!Number(range.is_blinking) && <span className="range-blink-tag">Blinks</span>}
                                            <button
                                                className="range-remove-btn"
                                                onClick={(e) => { e.stopPropagation(); handleRemoveRange(range); }}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="range-add-form">
                                <div className="range-add-field">
                                    <label>Starts at (%)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="e.g. 95"
                                        value={rangeDraft.start}
                                        onChange={(e) => setRangeDraft(prev => ({ ...prev, start: e.target.value }))}
                                    />
                                </div>
                                <div className="range-add-field">
                                    <label>Color</label>
                                    <div className="range-color-inputs">
                                        <input
                                            type="color"
                                            value={rangeDraft.color}
                                            onChange={(e) => setRangeDraft(prev => ({ ...prev, color: e.target.value }))}
                                        />
                                        <input
                                            type="text"
                                            className="range-color-hex"
                                            value={rangeDraft.color}
                                            onChange={(e) => setRangeDraft(prev => ({ ...prev, color: e.target.value }))}
                                        />
                                    </div>
                                </div>
                                <label className="range-blink-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={rangeDraft.blink}
                                        onChange={(e) => setRangeDraft(prev => ({ ...prev, blink: e.target.checked }))}
                                    />
                                    Blink
                                </label>
                                <button
                                    className="advance-config-save-btn"
                                    onClick={handleSaveRange}
                                    disabled={rangeSaveStatus === 'saving'}
                                >
                                    {rangeSaveStatus === 'saving' ? 'Saving...' : (rangeDraft.id ? 'Update' : '+ Add')}
                                </button>
                                {rangeDraft.id && (
                                    <button className="range-cancel-btn" onClick={handleCancelRangeEdit}>Cancel</button>
                                )}
                                {rangeSaveStatus === 'saved' && <span className="advance-config-status success">Saved.</span>}
                            </div>
                            {rangeError && <p className="range-error">{rangeError}</p>}
                        </div>
                    </div>
                )}
            </section>

            {exceptionsTeam && (
                <RunRateExceptionsModal
                    team={exceptionsTeam}
                    onClose={() => setExceptionsTeam(null)}
                />
            )}
        </div>
    );
};

export default ReportSettings;
