import React, { useState, useEffect, useMemo } from 'react';
import './Teams.css';
import './ReportSettings.css';
import './RunRateBillablePercentageModal.css';

// A billable % below 100 scales BOTH actual and scheduled hours by the same
// factor before Run Rate is computed for that employee — e.g. 50% turns a
// 7.99h/8h day into 3.995h/4h. 100% (the default) leaves hours untouched.
const RunRateBillablePercentageModal = ({ team, onClose }) => {
    const [employees, setEmployees] = useState([]);
    const [percentages, setPercentages] = useState({}); // { [employee_id]: string }
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
    const [saveError, setSaveError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch('./api/get_dashboard_stats.php')
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                const teamRows = (json.mtdEmployeeData || []).filter(row => row.team_name === team.name);
                setEmployees(teamRows.map(row => ({ employee_id: row.employee_id, name: row.name })));
                const initial = {};
                teamRows.forEach(row => { initial[row.employee_id] = String(Number(row.billable_percentage ?? 100)); });
                setPercentages(initial);
            })
            .catch(err => console.error('Failed to load billable percentages', err))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [team]);

    const handleChange = (employeeId, value) => {
        setPercentages(prev => ({ ...prev, [employeeId]: value }));
        setSaveStatus(null);
    };

    const filteredEmployees = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return employees.filter(emp => emp.name.toLowerCase().includes(term));
    }, [employees, searchTerm]);

    const handleSave = async () => {
        const parsed = employees.map(emp => ({
            employee_id: emp.employee_id,
            billable_percentage: Number(percentages[emp.employee_id])
        }));

        const invalid = parsed.find(p => isNaN(p.billable_percentage) || p.billable_percentage < 0 || p.billable_percentage > 100);
        if (invalid) {
            setSaveStatus('error');
            setSaveError('Every percentage must be a number between 0 and 100.');
            return;
        }

        setSaveStatus('saving');
        setSaveError(null);
        try {
            const res = await fetch('./api/manage_run_rate_billable_percentage.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employee_ids: employees.map(emp => emp.employee_id),
                    percentages: parsed
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
            console.error('Failed to save billable percentages', err);
            setSaveStatus('error');
            setSaveError('Failed to save.');
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <div>
                        <h2>Billable %</h2>
                        <p className="text-muted" style={{ margin: 0 }}>Team: {team.name}</p>
                    </div>
                    <button className="icon-btn" onClick={onClose} title="Close">✕</button>
                </div>

                <div className="modal-body">
                    <p className="text-muted" style={{ marginTop: 0 }}>
                        Scales both actual and scheduled hours by this percentage before Run Rate is
                        calculated — e.g. 50% turns a 7.99h / 8h day into 3.995h / 4h. Defaults to 100%
                        (no change) for anyone not listed here.
                    </p>
                    <input
                        type="text"
                        className="assignment-search"
                        placeholder="Search employees by name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />

                    {loading ? (
                        <p className="text-muted">Loading employees...</p>
                    ) : employees.length === 0 ? (
                        <p className="text-muted">No employees found in this team.</p>
                    ) : (
                        <div className="billable-pct-list">
                            {filteredEmployees.map(emp => (
                                <div key={emp.employee_id} className="billable-pct-row">
                                    <span className="billable-pct-name">{emp.name}</span>
                                    <div className="billable-pct-input-group">
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            step="0.01"
                                            className="billable-pct-input"
                                            value={percentages[emp.employee_id] ?? '100'}
                                            onChange={(e) => handleChange(emp.employee_id, e.target.value)}
                                        />
                                        <span className="billable-pct-suffix">%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {saveError && <p className="range-error">{saveError}</p>}
                </div>

                <div className="modal-footer">
                    {saveStatus === 'saved' && <span className="advance-config-status success" style={{ marginRight: 'auto' }}>Saved.</span>}
                    {saveStatus === 'error' && <span className="advance-config-status error" style={{ marginRight: 'auto' }}>Failed to save.</span>}
                    <button onClick={onClose}>Cancel</button>
                    <button className="btn-primary" onClick={handleSave} disabled={loading || saveStatus === 'saving'}>
                        {saveStatus === 'saving' ? 'Saving...' : 'Save Percentages'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RunRateBillablePercentageModal;
