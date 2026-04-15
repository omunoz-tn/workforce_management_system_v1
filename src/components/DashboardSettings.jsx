import React, { useState, useEffect } from 'react';
import './DashboardSettings.css';

const METRICS = [
    { id: 'online', label: 'Coverage', icon: '🎯' },
    { id: 'productivity', label: 'Avg. Productivity', icon: '⚡' },
    { id: 'late', label: 'Late Arrivals', icon: '⏰' },
    { id: 'topTeam', label: 'Top Productive Team', icon: '🏆' },
    { id: 'absenteeism', label: 'Absenteeism', icon: '📉' },
    { id: 'adherence', label: 'Adherence', icon: '✅' },
    { id: 'overtime', label: 'Overtime', icon: '🕒' },
    { id: 'totalHours', label: 'Total Hours Tracked', icon: '🕐' },
    { id: 'runRate', label: 'Run Rate', icon: '📈' },
];

const TEAM_SOURCES = [
    { id: 'desktime', label: 'DeskTime Native', desc: 'Use groups exactly as imported from DeskTime.', icon: '🏢' },
    { id: 'platform', label: 'Platform Hierarchy', desc: 'Use custom Groups/Teams defined in Settings > Organization.', icon: '🏗️' },
    { id: 'hybrid', label: 'Hybrid (Default)', desc: 'Prioritize custom teams, use DeskTime groups as fallback.', icon: '🔄' },
];

const DashboardSettings = () => {
    const [preferences, setPreferences] = useState({
        visibleMetrics: METRICS.map(m => m.id),
        teamSource: 'hybrid',
        showGroupsSection: true,
        showUnassigned: true,
        version: 2 // Increment this when adding new default metrics
    });

    useEffect(() => {
        const saved = localStorage.getItem('dashboard_preferences');
        if (saved) {
            const parsed = JSON.parse(saved);
            let mergedVisible = [...(parsed.visibleMetrics || [])];
            
            // VERSIONED MIGRATION: 
            // If user's preferences are old (version < 2), they don't have runRate.
            // We add it once, then the user can hide it.
            if (!parsed.version || parsed.version < 2) {
                if (!mergedVisible.includes('runRate')) {
                    mergedVisible.push('runRate');
                }
                parsed.version = 2;
                localStorage.setItem('dashboard_preferences', JSON.stringify({ ...parsed, visibleMetrics: mergedVisible }));
            }
            
            setPreferences({
                visibleMetrics: mergedVisible,
                teamSource: parsed.teamSource || 'hybrid',
                showGroupsSection: parsed.showGroupsSection !== undefined ? parsed.showGroupsSection : true,
                showUnassigned: parsed.showUnassigned !== undefined ? parsed.showUnassigned : true,
                version: parsed.version || 2
            });
        }
    }, []);

    const savePreferences = (newPrefs) => {
        setPreferences(newPrefs);
        localStorage.setItem('dashboard_preferences', JSON.stringify(newPrefs));
    };

    const toggleMetric = (metricId) => {
        const newVisible = preferences.visibleMetrics.includes(metricId)
            ? preferences.visibleMetrics.filter(id => id !== metricId)
            : [...preferences.visibleMetrics, metricId];
        savePreferences({ ...preferences, visibleMetrics: newVisible });
    };

    return (
        <div className="settings-dashboard-container">
            <header className="settings-header">
                <h1>Dashboard Preferences</h1>
                <p className="text-muted">Customize how your dashboard looks and where it gets its data from.</p>
            </header>

            <section className="settings-section">
                <h2>Metric Visibility</h2>
                <p className="section-desc">Select which stat-cards to display on the main dashboard.</p>
                <div className="metrics-toggle-grid">
                    {METRICS.map(metric => (
                        <div 
                            key={metric.id} 
                            className={`metric-toggle-card ${preferences.visibleMetrics.includes(metric.id) ? 'active' : ''}`}
                            onClick={() => toggleMetric(metric.id)}
                        >
                            <div className="metric-toggle-info">
                                <span className="metric-icon">{metric.icon}</span>
                                <span className="metric-label">{metric.label}</span>
                            </div>
                            <div className="toggle-switch">
                                <div className="switch-slider"></div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="settings-section">
                <h2>Organization & Team Source</h2>
                <p className="section-desc">Choose how employees are grouped into teams on the dashboard.</p>
                <div className="source-selector">
                    {TEAM_SOURCES.map(source => (
                        <div 
                            key={source.id} 
                            className={`source-card ${preferences.teamSource === source.id ? 'selected' : ''}`}
                            onClick={() => savePreferences({ ...preferences, teamSource: source.id })}
                        >
                            <div className="source-icon">{source.icon}</div>
                            <div className="source-content">
                                <h3>{source.label}</h3>
                                <p>{source.desc}</p>
                            </div>
                            {preferences.teamSource === source.id && <div className="check-badge">✓</div>}
                        </div>
                    ))}
                </div>
            </section>

            <section className="settings-section">
                <h2>Section Management</h2>
                <div className="inline-settings-row">
                    <div className="setting-info">
                        <h3>Show Online Teams Section</h3>
                        <p>Display the "Online Teams" list and status breakdown at the bottom of the dashboard.</p>
                    </div>
                    <div 
                        className={`toggle-switch large ${preferences.showGroupsSection ? 'on' : 'off'}`}
                        onClick={() => savePreferences({ ...preferences, showGroupsSection: !preferences.showGroupsSection })}
                    >
                        <div className="switch-slider"></div>
                    </div>
                </div>

                <div className="inline-settings-row" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                    <div className="setting-info">
                        <h3>Show Unassigned Team</h3>
                        <p>Display members who haven't been mapped to a specific platform team yet.</p>
                    </div>
                    <div 
                        className={`toggle-switch large ${preferences.showUnassigned !== false ? 'on' : 'off'}`}
                        onClick={() => savePreferences({ ...preferences, showUnassigned: preferences.showUnassigned === false })}
                    >
                        <div className="switch-slider"></div>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default DashboardSettings;
