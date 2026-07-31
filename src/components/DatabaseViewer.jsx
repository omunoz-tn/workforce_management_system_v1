import React, { useState, useEffect } from 'react';
import './DatabaseViewer.css';
import LoadingScreen from './LoadingScreen';

// Minimalist Table/Database Icon matching reference image
const DbTableIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="minimal-db-icon">
        <ellipse cx="9" cy="5" rx="5" ry="2.5" />
        <path d="M4 5v5c0 1.38 2.24 2.5 5 2.5s5-1.12 5-2.5V5" />
        <path d="M4 10v5c0 1.38 2.24 2.5 5 2.5s5-1.12 5-2.5v-5" />
        <rect x="11" y="11" width="10" height="10" rx="1.5" fill="var(--bg-secondary, #ffffff)" />
        <line x1="11" y1="14" x2="21" y2="14" />
        <line x1="11" y1="17" x2="21" y2="17" />
        <line x1="14" y1="11" x2="14" y2="21" />
        <line x1="18" y1="11" x2="18" y2="21" />
    </svg>
);

const DatabaseViewer = ({ onBack }) => {
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTable, setSelectedTable] = useState(null);
    const [details, setDetails] = useState(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('data'); // Default Tab is now "Recent Data"
    const [isAllLoaded, setIsAllLoaded] = useState(false);

    // Global table data filters and sort states
    const [globalSearch, setGlobalSearch] = useState('');
    const [columnFilters, setColumnFilters] = useState({});
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

    // Unified modal state for Load Data refactoring
    const initialModalState = {
        isOpen: false,
        fromDate: "2026-05-01",
        toDate: "2026-05-19",
        employeeName: '',
        team: '',
        count: null,
        countLoading: false,
        error: null
    };
    const [modalState, setModalState] = useState(initialModalState);

    // Fetch the list of tables
    const fetchTables = async (selectFirst = false) => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('./api/get_database_info.php?action=list');
            const result = await response.json();
            if (result.success) {
                const fetchedTables = result.tables || [];
                setTables(fetchedTables);
                if (selectFirst && fetchedTables.length > 0) {
                    handleSelectTable(fetchedTables[0].name);
                }
            } else {
                setError(result.error || "Failed to load database tables.");
            }
        } catch (err) {
            setError("Failed to connect to the server.");
        } finally {
            setLoading(false);
        }
    };

    // Fetch details for a specific table
    const handleSelectTable = async (tableName) => {
        setSelectedTable(tableName);
        setDetailsLoading(true);
        setDetails(null);
        setIsAllLoaded(false);
        setGlobalSearch('');
        setColumnFilters({});
        setSortConfig({ key: null, direction: 'asc' });
        
        // Reset modal state for the new table
        setModalState(initialModalState);

        try {
            const response = await fetch(`./api/get_database_info.php?action=details&table=${encodeURIComponent(tableName)}`);
            const result = await response.json();
            if (result.success) {
                setDetails(result);
            } else {
                setError(result.error || `Failed to load details for ${tableName}`);
            }
        } catch (err) {
            setError(`Failed to fetch details for ${tableName}`);
        } finally {
            setDetailsLoading(false);
        }
    };

    const columnsList = details?.schema ? details.schema.map(c => c.Field) : [];
    const hasDateCol = columnsList.some(col => ['log_date', 'created_at', 'timestamp', 'updated_at'].includes(col));
    const hasNameCol = columnsList.some(col => ['name', 'employee_name'].includes(col));
    const hasTeamCol = columnsList.some(col => ['group_name', 'team_name'].includes(col));

    // Debounced Live Record Counting Hook
    useEffect(() => {
        if (!modalState.isOpen || !selectedTable) return;
        
        // Date range is mandatory if the table has date columns
        if (hasDateCol && (!modalState.fromDate || !modalState.toDate)) {
            setModalState(prev => ({ ...prev, count: null }));
            return;
        }

        setModalState(prev => ({ ...prev, countLoading: true, error: null }));

        const delayDebounceFn = setTimeout(async () => {
            try {
                const params = new URLSearchParams({
                    action: 'count',
                    table: selectedTable,
                    start_date: hasDateCol ? modalState.fromDate : '',
                    end_date: hasDateCol ? modalState.toDate : '',
                    filter_name: hasNameCol ? modalState.employeeName : '',
                    filter_team: hasTeamCol ? modalState.team : ''
                });
                const response = await fetch(`./api/get_database_info.php?${params.toString()}`);
                const result = await response.json();
                if (result.success) {
                    setModalState(prev => ({ ...prev, count: result.count }));
                } else {
                    setModalState(prev => ({ ...prev, error: result.error || "Failed to count matching records." }));
                }
            } catch (err) {
                setModalState(prev => ({ ...prev, error: "Network error while calculating volume." }));
            } finally {
                setModalState(prev => ({ ...prev, countLoading: false }));
            }
        }, 350);

        return () => clearTimeout(delayDebounceFn);
    }, [modalState.isOpen, selectedTable, modalState.fromDate, modalState.toDate, modalState.employeeName, modalState.team, hasDateCol, hasNameCol, hasTeamCol]);

    // Load Filtered Data from Modal selections
    const handleLoadFilteredData = async () => {
        if (!selectedTable) return;
        setDetailsLoading(true);
        setError(null);
        setModalState(prev => ({ ...prev, isOpen: false }));

        try {
            const params = new URLSearchParams({
                action: 'details',
                table: selectedTable,
                limit: 'all',
                start_date: hasDateCol ? modalState.fromDate : '',
                end_date: hasDateCol ? modalState.toDate : '',
                filter_name: hasNameCol ? modalState.employeeName : '',
                filter_team: hasTeamCol ? modalState.team : ''
            });

            const response = await fetch(`./api/get_database_info.php?${params.toString()}`);
            const result = await response.json();
            if (result.success) {
                setDetails(result);
                setIsAllLoaded(true);
            } else {
                setError(result.error || `Failed to load data for ${selectedTable}`);
            }
        } catch (err) {
            setError(`Failed to load data for ${selectedTable}`);
        } finally {
            setDetailsLoading(false);
        }
    };

    const handleCloseModal = () => {
        setModalState(initialModalState);
    };

    const handleOpenModal = () => {
        setModalState({
            ...initialModalState,
            isOpen: true
        });
    };

    // Filter & Sort table records client side
    let processedRecords = [];
    if (details && details.records) {
        processedRecords = [...details.records];

        // 1. Apply Global Search
        if (globalSearch.trim() !== '') {
            const query = globalSearch.toLowerCase();
            processedRecords = processedRecords.filter(row => 
                Object.values(row).some(val => 
                    val !== null && String(val).toLowerCase().includes(query)
                )
            );
        }

        // 2. Apply Column Filters
        Object.keys(columnFilters).forEach(col => {
            const query = columnFilters[col];
            if (query && query.trim() !== '') {
                const filterQuery = query.toLowerCase();
                processedRecords = processedRecords.filter(row => 
                    row[col] !== null && String(row[col]).toLowerCase().includes(filterQuery)
                );
            }
        });

        // 3. Apply Column Sorting
        if (sortConfig.key) {
            processedRecords.sort((a, b) => {
                const aVal = a[sortConfig.key];
                const bVal = b[sortConfig.key];
                
                if (aVal === null) return sortConfig.direction === 'asc' ? 1 : -1;
                if (bVal === null) return sortConfig.direction === 'asc' ? -1 : 1;
                
                const aStr = String(aVal);
                const bStr = String(bVal);
                
                // Try numerical comparison first
                const aNum = Number(aVal);
                const bNum = Number(bVal);
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
                }
                
                // Text alphabetical comparison
                return sortConfig.direction === 'asc' 
                    ? aStr.localeCompare(bStr) 
                    : bStr.localeCompare(aStr);
            });
        }
    }

    // Export CSV of currently filtered and loaded data
    const handleExportCSV = () => {
        if (!details || processedRecords.length === 0) return;
        
        const headers = Object.keys(processedRecords[0]);
        const csvRows = [];
        
        // Add Headers row
        csvRows.push(headers.join(','));
        
        // Add Data rows
        for (const row of processedRecords) {
            const values = headers.map(header => {
                const cellValue = row[header] === null ? '' : String(row[header]);
                // Escape quotes
                const escaped = cellValue.replace(/"/g, '""');
                return `"${escaped}"`;
            });
            csvRows.push(values.join(','));
        }
        
        const blob = new Blob(["\uFEFF" + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${details.table}_export.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    useEffect(() => {
        fetchTables(true);
    }, []);

    // Filter tables based on sidebar search
    const filteredTables = tables.filter(t => 
        t.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Update column filters
    const handleColumnFilterChange = (colName, val) => {
        setColumnFilters(prev => ({
            ...prev,
            [colName]: val
        }));
    };

    // Toggle Sorting on columns
    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    return (
        <div className="db-viewer-container">
            {/* Header */}
            <header className="db-viewer-header">
                <div className="header-left">
                    <button className="back-btn" onClick={onBack}>← Back</button>
                    <div>
                        <h1>Database Viewer</h1>
                        <p className="subtitle">Real-time database tables inspector</p>
                    </div>
                </div>
                <button className="refresh-btn" onClick={() => fetchTables(false)}>
                    🔄 Refresh Tables List
                </button>
            </header>

            {error && (
                <div className="error-banner">
                    <span>⚠️ Error: {error}</span>
                    <button className="close-error" onClick={() => setError(null)}>×</button>
                </div>
            )}

            {loading ? (
                <LoadingScreen loading={loading} message="Analyzing database tables structure..." />
            ) : (
                <div className="db-viewer-content">
                    {/* Left Pane - Table List */}
                    <div className="db-tables-sidebar">
                        <div className="sidebar-search">
                            <input 
                                type="text" 
                                placeholder="Search tables..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button className="clear-search" onClick={() => setSearchQuery('')}>×</button>
                            )}
                        </div>

                        <div className="tables-list">
                            {filteredTables.length > 0 ? (
                                filteredTables.map((t) => (
                                    <div 
                                        key={t.name}
                                        className={`table-item-card ${selectedTable === t.name ? 'active' : ''}`}
                                        onClick={() => handleSelectTable(t.name)}
                                    >
                                        <div className="table-item-info">
                                            <span className="table-icon">
                                                <DbTableIcon />
                                            </span>
                                            <span className="db-table-name-sidebar" title={t.name}>{t.name}</span>
                                        </div>
                                        <span className="table-rows-badge">
                                            {t.rows.toLocaleString()} rows
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <div className="empty-search-state">
                                    No tables match your search query.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Pane - Selected Table Details */}
                    <div className="db-table-details-panel">
                        {detailsLoading ? (
                            <div className="details-loader">
                                <div className="spinner-medium"></div>
                                <p>Fetching schema & recent rows for <strong>{selectedTable}</strong>...</p>
                            </div>
                        ) : details ? (
                            <div className="table-details-wrapper">
                                {/* Table Detail Header */}
                                <div className="details-header">
                                    <div className="details-header-title">
                                        <h2>{details.table}</h2>
                                        <span className="table-total-rows">
                                            Total in DB: <strong>{details.rows.toLocaleString()}</strong> rows 
                                            {activeTab === 'data' && (
                                                <span> | Loaded: <strong>{details.records.length.toLocaleString()}</strong> rows</span>
                                            )}
                                        </span>
                                    </div>
                                    <div className="tab-navigation">
                                        <button 
                                            className={`tab-btn ${activeTab === 'data' ? 'active' : ''}`}
                                            onClick={() => setActiveTab('data')}
                                        >
                                            💾 Recent Data ({isAllLoaded ? 'All' : 'Last 50'})
                                        </button>
                                        <button 
                                            className={`tab-btn ${activeTab === 'structure' ? 'active' : ''}`}
                                            onClick={() => setActiveTab('structure')}
                                        >
                                            🛠️ Structure / Schema
                                        </button>
                                    </div>
                                </div>

                                {/* Tab Contents */}
                                <div className="tab-content-panel">
                                    {activeTab === 'structure' ? (
                                        <div className="schema-tab-content">
                                            <table className="viewer-table">
                                                <thead>
                                                    <tr>
                                                        <th>Column</th>
                                                        <th>Type</th>
                                                        <th>Null</th>
                                                        <th>Key</th>
                                                        <th>Default</th>
                                                        <th>Extra</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {details.schema.map((col, idx) => (
                                                        <tr key={idx} className={col.Key === 'PRI' ? 'primary-key-row' : ''}>
                                                            <td className="col-field font-mono font-bold">
                                                                {col.Key === 'PRI' && <span className="key-icon" title="Primary Key">🔑 </span>}
                                                                {col.Field}
                                                            </td>
                                                            <td className="col-type font-mono">{col.Type}</td>
                                                            <td>
                                                                <span className={`null-badge ${col.Null === 'YES' ? 'nullable' : 'not-nullable'}`}>
                                                                    {col.Null}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                {col.Key ? (
                                                                    <span className={`key-badge ${col.Key.toLowerCase()}`}>
                                                                        {col.Key}
                                                                    </span>
                                                                ) : '-'}
                                                            </td>
                                                            <td className="col-default font-mono">
                                                                {col.Default === null ? <span className="null-val">NULL</span> : col.Default}
                                                            </td>
                                                            <td className="col-extra font-mono text-muted">{col.Extra || '-'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="data-tab-content">
                                            {/* Advanced Controls Toolbar */}
                                            <div className="table-controls-toolbar">
                                                <div className="search-input-wrapper">
                                                    <span className="search-icon">🔍</span>
                                                    <input 
                                                        type="text" 
                                                        placeholder="Search all columns..." 
                                                        value={globalSearch}
                                                        onChange={(e) => setGlobalSearch(e.target.value)}
                                                    />
                                                    {globalSearch && (
                                                        <button className="clear-search-btn" onClick={() => setGlobalSearch('')}>×</button>
                                                    )}
                                                </div>
                                                <div className="toolbar-actions">
                                                    {details.rows > 50 && (
                                                         <button className="load-data-btn" onClick={handleOpenModal}>
                                                             ⚡ Load Data
                                                         </button>
                                                     )}
                                                    <button className="export-csv-btn" onClick={handleExportCSV}>
                                                        📥 Export CSV
                                                    </button>
                                                </div>
                                            </div>

                                            {details.is_capped && (
                                                <div className="capped-warning-banner">
                                                    ⚠️ <strong>Performance Safety Shield Active:</strong> Showing the first <strong>{details.cap_limit.toLocaleString()}</strong> rows (out of <strong>{details.rows.toLocaleString()}</strong> in DB) to protect system memory and prevent browser crashes.
                                                </div>
                                            )}

                                            {details.records.length > 0 ? (
                                                <div className="records-table-container">
                                                    <table className="viewer-table records-table">
                                                        <thead>
                                                            {/* Row 1: Header names with sort triggers */}
                                                            <tr>
                                                                {Object.keys(details.records[0]).map((key) => (
                                                                    <th 
                                                                        key={key} 
                                                                        onClick={() => handleSort(key)} 
                                                                        className="sortable-header font-mono"
                                                                        title="Click to toggle sorting"
                                                                    >
                                                                        <div className="header-cell-content">
                                                                            <span>{key}</span>
                                                                            <span className="sort-indicator">
                                                                                {sortConfig.key === key 
                                                                                    ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') 
                                                                                    : ' ↕'}
                                                                            </span>
                                                                        </div>
                                                                    </th>
                                                                ))}
                                                            </tr>
                                                            {/* Row 2: In-line column specific filters */}
                                                            <tr className="filter-input-row">
                                                                {Object.keys(details.records[0]).map((key) => (
                                                                    <th key={`filter-${key}`} className="filter-cell-header">
                                                                        <input 
                                                                            type="text" 
                                                                            placeholder={`Filter ${key}...`}
                                                                            value={columnFilters[key] || ''}
                                                                            onChange={(e) => handleColumnFilterChange(key, e.target.value)}
                                                                            className="column-filter-input font-mono"
                                                                        />
                                                                    </th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {processedRecords.length > 0 ? (
                                                                processedRecords.map((row, rowIdx) => (
                                                                    <tr key={rowIdx}>
                                                                        {Object.values(row).map((val, cellIdx) => (
                                                                            <td key={cellIdx} className="font-mono cell-value">
                                                                                {val === null ? (
                                                                                    <span className="null-val">NULL</span>
                                                                                ) : typeof val === 'object' ? (
                                                                                    JSON.stringify(val)
                                                                                ) : (
                                                                                    String(val)
                                                                                )}
                                                                            </td>
                                                                        ))}
                                                                    </tr>
                                                                ))
                                                            ) : (
                                                                <tr>
                                                                    <td colSpan={Object.keys(details.records[0]).length} className="no-matches-cell">
                                                                        No records match active search or filters.
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <div className="empty-table-state">
                                                    <div className="empty-state-icon">📂</div>
                                                    <h3>No Records Found</h3>
                                                    <p>This table is currently empty or has no records to display.</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="select-table-prompt">
                                <div className="prompt-icon">🔍</div>
                                <h2>No Table Selected</h2>
                                <p>Select a table from the sidebar to inspect its structure and raw contents.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {modalState.isOpen && (
                <div className="modal-backdrop">
                    <div className="modal-content-card">
                        <div className="modal-card-header">
                            <h3>⚡ Extract & Load Data</h3>
                            <button className="modal-close-btn" onClick={handleCloseModal}>×</button>
                        </div>
                        <div className="modal-card-body">
                            <p className="modal-instruction">
                                Configure the criteria to load data. The date range is required. Leave optional fields blank to ignore them.
                            </p>

                            {modalState.error && (
                                <div className="modal-error-box">
                                    ⚠️ {modalState.error}
                                </div>
                            )}

                            <div className="modal-form-grid">
                                <div className="form-group date-group">
                                    <label>📅 Date Range (Required)</label>
                                    <div className="date-inputs-row">
                                        <div className="date-field">
                                            <span>From:</span>
                                            <input 
                                                type="date" 
                                                value={modalState.fromDate}
                                                onChange={(e) => setModalState(prev => ({ ...prev, fromDate: e.target.value }))}
                                                disabled={!hasDateCol}
                                            />
                                        </div>
                                        <div className="date-field">
                                            <span>To:</span>
                                            <input 
                                                type="date" 
                                                value={modalState.toDate}
                                                onChange={(e) => setModalState(prev => ({ ...prev, toDate: e.target.value }))}
                                                disabled={!hasDateCol}
                                            />
                                        </div>
                                    </div>
                                    {!hasDateCol && (
                                        <span className="field-notice">This table doesn't support date filtering.</span>
                                    )}
                                </div>

                                <div className="form-group">
                                    <label>👤 Employee Name (Optional)</label>
                                    <input 
                                        type="text" 
                                        placeholder={hasNameCol ? "Enter name (e.g. John Doe)..." : "Not supported for this table"}
                                        value={modalState.employeeName}
                                        onChange={(e) => setModalState(prev => ({ ...prev, employeeName: e.target.value }))}
                                        disabled={!hasNameCol}
                                        className="modal-text-input"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>👥 Team / Group (Optional)</label>
                                    <input 
                                        type="text" 
                                        placeholder={hasTeamCol ? "Enter team name (e.g. PD HVAC)..." : "Not supported for this table"}
                                        value={modalState.team}
                                        onChange={(e) => setModalState(prev => ({ ...prev, team: e.target.value }))}
                                        disabled={!hasTeamCol}
                                        className="modal-text-input"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="modal-card-footer">
                            <div className="live-counter-section">
                                {modalState.countLoading ? (
                                    <div className="small-counter-loader">
                                        <span className="tiny-spinner"></span> Calculating volume...
                                    </div>
                                ) : modalState.count !== null ? (
                                    <div className={`count-badge-preview ${modalState.count > 10000 ? 'count-exceeded' : ''}`}>
                                        📊 <strong>{modalState.count.toLocaleString()}</strong> records found
                                    </div>
                                ) : null}
                            </div>

                            <div className="footer-actions">
                                <button className="modal-cancel-btn" onClick={handleCloseModal}>Cancel</button>
                                <button 
                                    className={`modal-confirm-btn ${modalState.count > 10000 || (hasDateCol && (!modalState.fromDate || !modalState.toDate)) ? 'btn-disabled' : ''}`}
                                    onClick={handleLoadFilteredData}
                                    disabled={modalState.count > 10000 || (hasDateCol && (!modalState.fromDate || !modalState.toDate))}
                                >
                                    Cargar Datos
                                </button>
                            </div>
                        </div>

                        {modalState.count > 10000 && (
                            <div className="modal-footer-alert animate-fade-in">
                                ⚠️ <strong>Limit Exceeded:</strong> The selection contains <strong>{modalState.count.toLocaleString()}</strong> records. Please narrow the date range or add more specific filters (Max 10,000).
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
};

export default DatabaseViewer;