import React, { useState, useEffect, useMemo } from 'react';
import './BillableEmployees.css';
import LoadingScreen from './LoadingScreen';

const BillableEmployees = ({ onBack }) => {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All'); // 'All', 'Billable', 'Non-Billable'
    const [selectedIds, setSelectedIds] = useState(new Set());

    const fetchEmployees = async () => {
        try {
            setLoading(true);
            const res = await fetch('./api/get_billable_employees.php');
            const data = await res.json();
            if (data.success) {
                setEmployees(data.data);
            } else {
                setError(data.error);
            }
        } catch (err) {
            setError("Failed to fetch employees.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEmployees();
    }, []);

    const handleUpdateStatus = async (employeeIds, isBillable) => {
        try {
            const res = await fetch('./api/update_billable_status.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employee_ids: employeeIds, is_billable: isBillable })
            });
            const data = await res.json();
            if (data.success) {
                setEmployees(prev => prev.map(emp => 
                    employeeIds.includes(emp.employee_id) ? { ...emp, is_billable: isBillable ? 1 : 0 } : emp
                ));
            } else {
                alert("Failed to update status: " + data.error);
            }
        } catch (err) {
            alert("Error updating status.");
        }
    };

    const toggleRowSelection = (id) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const filteredEmployees = useMemo(() => {
        return employees.filter(emp => {
            const searchLower = searchTerm.toLowerCase();
            const matchesSearch = 
                (emp.name || '').toLowerCase().includes(searchLower) || 
                (emp.team || '').toLowerCase().includes(searchLower);
            
            const matchesStatus = 
                statusFilter === 'All' ? true :
                statusFilter === 'Billable' ? emp.is_billable == 1 :
                emp.is_billable == 0;

            return matchesSearch && matchesStatus;
        });
    }, [employees, searchTerm, statusFilter]);

    const handleSelectAll = () => {
        const ids = filteredEmployees.map(emp => emp.employee_id);
        setSelectedIds(new Set(ids));
    };

    const handleDeselectAll = () => {
        setSelectedIds(new Set());
    };

    const handleBulkMakeBillable = () => {
        if (selectedIds.size === 0) return;
        handleUpdateStatus(Array.from(selectedIds), true);
    };

    const handleBulkMakeNonBillable = () => {
        if (selectedIds.size === 0) return;
        handleUpdateStatus(Array.from(selectedIds), false);
    };

    const handleExportCSV = () => {
        if (filteredEmployees.length === 0) {
            alert("No data available to export.");
            return;
        }
        
        const headers = ['Name', 'Team', 'Status'];
        const csvRows = filteredEmployees.map(emp => {
            const name = (emp.name || '').replace(/"/g, '""');
            const team = (emp.team || '').replace(/"/g, '""');
            const status = emp.is_billable == 1 ? 'Billable' : 'Non-Billable';
            return `"${name}","${team}","${status}"`;
        });
        
        const csvContent = [headers.join(','), ...csvRows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'billable_employees_setup.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="billable-employees-container">
            <LoadingScreen loading={loading && employees.length === 0} message="Loading Employees..." />
            
            <header className="billable-header">
                <h2>Billable Employees Setup</h2>
                <div className="billable-filters">
                    <input 
                        type="text" 
                        placeholder="Filter by name or team..." 
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="search-input"
                    />
                    <select 
                        value={statusFilter} 
                        onChange={e => setStatusFilter(e.target.value)}
                        className="status-dropdown"
                    >
                        <option value="All">All Statuses</option>
                        <option value="Billable">Billable Only</option>
                        <option value="Non-Billable">Non-Billable Only</option>
                    </select>
                </div>
            </header>

            {error ? (
                <div className="error-message">Error: {error}</div>
            ) : (
                <>
                    <div className="table-controls">
                        <div className="selection-links">
                            <button onClick={handleSelectAll} className="link-btn">Select All</button>
                            <span className="separator">|</span>
                            <button onClick={handleDeselectAll} className="link-btn">Deselect All</button>
                            <span className="separator">|</span>
                            <button onClick={handleExportCSV} className="link-btn">Export CSV</button>
                            <span className="selection-count">({selectedIds.size} selected)</span>
                        </div>
                        <div className="bulk-actions">
                            <button 
                                onClick={handleBulkMakeBillable} 
                                disabled={selectedIds.size === 0}
                                className={`btn-bulk-billable ${selectedIds.size === 0 ? 'disabled' : ''}`}
                            >
                                Make Selection Billable
                            </button>
                            <button 
                                onClick={handleBulkMakeNonBillable} 
                                disabled={selectedIds.size === 0}
                                className={`btn-bulk-nonbillable ${selectedIds.size === 0 ? 'disabled' : ''}`}
                            >
                                Make Selection Non-Billable
                            </button>
                        </div>
                    </div>

                    <div className="billable-table-wrapper">
                        <table className="billable-table">
                            <thead>
                                <tr>
                                    <th width="40px"></th>
                                    <th>Name</th>
                                    <th>Team</th>
                                    <th>Status</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredEmployees.length > 0 ? (
                                    filteredEmployees.map(emp => {
                                        const isSelected = selectedIds.has(emp.employee_id);
                                        const isBillable = emp.is_billable == 1;

                                        return (
                                            <tr 
                                                key={emp.employee_id} 
                                                className={`employee-row ${isSelected ? 'selected' : ''}`}
                                                onClick={() => toggleRowSelection(emp.employee_id)}
                                            >
                                                <td className="center-col">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={isSelected} 
                                                        readOnly 
                                                        onClick={(e) => e.stopPropagation() /* prevent double toggle if they click exact checkbox */} 
                                                        onChange={() => toggleRowSelection(emp.employee_id)}
                                                    />
                                                </td>
                                                <td>{emp.name}</td>
                                                <td>{emp.team}</td>
                                                <td>
                                                    <span className={`status-badge ${isBillable ? 'billable' : 'non-billable'}`}>
                                                        {isBillable ? 'Billable' : 'Non-Billable'}
                                                    </span>
                                                </td>
                                                <td className="text-right switch-col" onClick={(e) => e.stopPropagation()}>
                                                    <div className="toggle-container">
                                                        <label className="switch">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={isBillable}
                                                                onChange={(e) => handleUpdateStatus([emp.employee_id], e.target.checked)}
                                                            />
                                                            <span className="slider round"></span>
                                                        </label>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan="5" className="no-results">No employees match your filters.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
};

export default BillableEmployees;
