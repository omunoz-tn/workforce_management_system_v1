import React, { useState, useEffect, useMemo } from 'react';
import './Teams.css';
import './ReportSettings.css';

// Selected (orange) = counted in Run Rate. Deselecting an employee records
// them as an exception — they're excluded from every Run Rate figure
// (Dashboard card, standalone Run Rate Report, and their drill-downs) until
// re-selected here. Mirrors the Employees > Teams "Assign Members" picker.
const RunRateExceptionsModal = ({ team, onClose }) => {
    const [employees, setEmployees] = useState([]);
    const [excludedIds, setExcludedIds] = useState(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                // Sourced from the same Month-to-Date roster the Run Rate report itself
                // uses — unlike a "today only" employee snapshot, this reliably includes
                // every team (some teams may have no activity logged today).
                const res = await fetch('./api/get_dashboard_stats.php');
                const json = await res.json();
                if (cancelled) return;

                const teamRows = (json.mtdEmployeeData || []).filter(row => row.team_name === team.name);
                setEmployees(teamRows.map(row => ({ employee_id: row.employee_id, name: row.name })));
                setExcludedIds(new Set(teamRows.filter(row => Number(row.is_excluded)).map(row => row.employee_id)));
            } catch (err) {
                console.error('Failed to load run rate exceptions', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [team]);

    const toggleExclusion = (employeeId) => {
        setExcludedIds(prev => {
            const next = new Set(prev);
            if (next.has(employeeId)) next.delete(employeeId); else next.add(employeeId);
            return next;
        });
        setSaveStatus(null);
    };

    const includeAll = () => { setExcludedIds(new Set()); setSaveStatus(null); };
    const excludeAll = () => { setExcludedIds(new Set(employees.map(emp => emp.employee_id))); setSaveStatus(null); };

    const filteredEmployees = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return employees.filter(emp => emp.name.toLowerCase().includes(term));
    }, [employees, searchTerm]);

    const handleSave = async () => {
        setSaveStatus('saving');
        try {
            const res = await fetch('./api/manage_run_rate_exceptions.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employee_ids: employees.map(emp => emp.employee_id),
                    excluded_employee_ids: [...excludedIds]
                })
            });
            const json = await res.json();
            setSaveStatus(json.success ? 'saved' : 'error');
        } catch (err) {
            console.error('Failed to save run rate exceptions', err);
            setSaveStatus('error');
        }
    };

    const includedCount = employees.length - excludedIds.size;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <div>
                        <h2>Employees Exceptions</h2>
                        <p className="text-muted" style={{ margin: 0 }}>Team: {team.name}</p>
                    </div>
                    <div className="header-right-group">
                        <div className="bulk-selection-links">
                            <span className="selection-link" onClick={includeAll}>Select All</span>
                            <span className="sep">|</span>
                            <span className="selection-link" onClick={excludeAll}>Deselect All</span>
                        </div>
                        <button className="icon-btn" onClick={onClose} title="Close">✕</button>
                    </div>
                </div>

                <div className="modal-body">
                    <p className="text-muted" style={{ marginTop: 0 }}>
                        Only selected employees count toward this team's Run Rate. Deselect an employee to
                        exclude them as an exception.
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
                        <div className="employee-selection-list">
                            {filteredEmployees.map(emp => (
                                <div
                                    key={emp.employee_id}
                                    className={`employee-select-item ${excludedIds.has(emp.employee_id) ? '' : 'selected'}`}
                                    onClick={() => toggleExclusion(emp.employee_id)}
                                >
                                    {emp.name}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <span style={{ marginRight: 'auto', fontSize: '0.9rem' }}>{includedCount} of {employees.length} counted</span>
                    {saveStatus === 'saved' && <span className="advance-config-status success">Saved.</span>}
                    {saveStatus === 'error' && <span className="advance-config-status error">Failed to save. Try again.</span>}
                    <button onClick={onClose}>Cancel</button>
                    <button className="btn-primary" onClick={handleSave} disabled={loading || saveStatus === 'saving'}>
                        {saveStatus === 'saving' ? 'Saving...' : 'Save Exceptions'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RunRateExceptionsModal;
