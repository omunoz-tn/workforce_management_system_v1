import React, { useState, useEffect, useMemo } from 'react';
import {
    AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import './ProjectAnalyticsDashboard.css';

const CHART_COLORS = ['#3182ce', '#319795', '#dd6b20', '#805ad5', '#4c51bf', '#e53e3e', '#ecc94b', '#d53f8c'];

const ProjectAnalyticsDashboard = () => {
    // Dates states
    const [fromDate, setFromDate] = useState(() => {
        const d = new Date();
        d.setDate(1); // Default to first day of current month
        return d.toISOString().split('T')[0];
    });
    const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [activePreset, setActivePreset] = useState('current-month');

    // Filters states
    const [selectedTeam, setSelectedTeam] = useState('');
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [selectedProject, setSelectedProject] = useState('');
    const [selectedAccount, setSelectedAccount] = useState('');

    // Raw loaded choice options for select menus
    const [filterOptions, setFilterOptions] = useState({
        teams: [],
        employees: [],
        projects: []
    });

    // Data fetched states
    const [analyticsData, setAnalyticsData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Chart types toggles
    const [trendChartType, setTrendChartType] = useState('area'); // 'area', 'bar', 'line'
    const [distributionChartType, setDistributionChartType] = useState('bar'); // 'bar', 'pie'

    // Table Search and Pagination
    const [tableSearch, setTableSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // Helper: Convert seconds to HH:MM:SS
    const formatDuration = (seconds) => {
        if (!seconds) return '0:00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    // Helper: Convert seconds to fractional hours (e.g. 2.5h) for easier charting
    const formatHours = (seconds) => {
        if (!seconds) return 0;
        return parseFloat((seconds / 3600).toFixed(2));
    };

    // Date presets handler
    const applyPreset = (preset) => {
        setActivePreset(preset);
        const today = new Date();
        let from = '';
        let to = today.toISOString().split('T')[0];

        switch (preset) {
            case 'today':
                from = to;
                break;
            case 'yesterday': {
                const yest = new Date();
                yest.setDate(today.getDate() - 1);
                from = yest.toISOString().split('T')[0];
                to = from;
                break;
            }
            case 'last-7': {
                const last7 = new Date();
                last7.setDate(today.getDate() - 6);
                from = last7.toISOString().split('T')[0];
                break;
            }
            case 'last-30': {
                const last30 = new Date();
                last30.setDate(today.getDate() - 29);
                from = last30.toISOString().split('T')[0];
                break;
            }
            case 'current-month': {
                const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                from = firstDay.toISOString().split('T')[0];
                break;
            }
            default:
                return;
        }
        setFromDate(from);
        setToDate(to);
    };

    // Fetch analytical data from backend API
    const fetchAnalytics = async () => {
        setLoading(true);
        setError(null);
        try {
            let url = `./api/get_project_analytics.php?from=${fromDate}&to=${toDate}`;
            if (selectedTeam) url += `&team=${encodeURIComponent(selectedTeam)}`;
            if (selectedEmployee) url += `&employee=${encodeURIComponent(selectedEmployee)}`;
            if (selectedProject) url += `&project=${encodeURIComponent(selectedProject)}`;
            if (selectedAccount) url += `&account=${encodeURIComponent(selectedAccount)}`;

            const res = await fetch(url);
            const result = await res.json();

            if (result.success) {
                setAnalyticsData(result.data);
                // Only update filter dropdown options if they are loaded
                if (result.filters) {
                    setFilterOptions(result.filters);
                }
            } else {
                setError(result.error || 'Failed to load project analytics data.');
            }
        } catch (err) {
            console.error("Fetch Error:", err);
            setError('Could not establish connection with database API.');
        } finally {
            setLoading(false);
        }
    };

    // Fetch on initial load or filters change
    useEffect(() => {
        fetchAnalytics();
    }, [fromDate, toDate, selectedTeam, selectedEmployee, selectedProject, selectedAccount]);

    // Handle Custom Date Range inputs
    const handleCustomDateChange = (type, val) => {
        setActivePreset('custom');
        if (type === 'from') setFromDate(val);
        if (type === 'to') setToDate(val);
    };

    // Dynamic aggregated statistics calculations for the raw details table
    // (This parses the projects list or aggregates tasks matching search)
    const tableData = useMemo(() => {
        if (!analyticsData || !analyticsData.tasks) return [];
        // Map tasks as raw list rows
        return analyticsData.tasks.filter(t => 
            t.name.toLowerCase().includes(tableSearch.toLowerCase()) ||
            t.project.toLowerCase().includes(tableSearch.toLowerCase())
        );
    }, [analyticsData, tableSearch]);

    // Pagination logic
    const totalPages = Math.ceil(tableData.length / rowsPerPage);
    const paginatedTableData = useMemo(() => {
        const start = (currentPage - 1) * rowsPerPage;
        return tableData.slice(start, start + rowsPerPage);
    }, [tableData, currentPage, rowsPerPage]);

    // Reset pagination page on search change
    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearch]);

    // Export raw filtered table rows to CSV
    const exportCSV = () => {
        if (tableData.length === 0) return;
        const headers = ["Project", "Task/Description", "Total Duration (seconds)", "Time Formatted"];
        const rows = tableData.map(row => [
            `"${row.project}"`,
            `"${row.name}"`,
            row.value,
            formatDuration(row.value)
        ]);

        const csvContent = [
            headers.join(","),
            ...rows.map(r => r.join(","))
        ].join("\n");

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Project_Tasks_Report_${fromDate}_to_${toDate}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Chart Formatters
    const trendChartData = useMemo(() => {
        if (!analyticsData || !analyticsData.trend) return [];
        return analyticsData.trend.map(t => ({
            date: new Date(t.date + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
            hours: formatHours(t.duration)
        }));
    }, [analyticsData]);

    const projectChartData = useMemo(() => {
        if (!analyticsData || !analyticsData.projects) return [];
        return analyticsData.projects.slice(0, 10).map(p => ({
            name: p.name.length > 20 ? p.name.substring(0, 18) + '...' : p.name,
            hours: formatHours(p.value),
            rawValue: p.value
        }));
    }, [analyticsData]);

    const agentChartData = useMemo(() => {
        if (!analyticsData || !analyticsData.agents) return [];
        return analyticsData.agents.slice(0, 10).map(a => ({
            name: a.name,
            team: a.team,
            hours: formatHours(a.value)
        }));
    }, [analyticsData]);

    const teamChartData = useMemo(() => {
        if (!analyticsData || !analyticsData.teams) return [];
        return analyticsData.teams.map(t => ({
            name: t.name,
            hours: formatHours(t.value)
        }));
    }, [analyticsData]);

    const kpis = analyticsData?.kpis || {
        total_duration: 0,
        active_projects: 0,
        active_agents: 0,
        active_tasks: 0,
        avg_task_duration: 0
    };

    // Recharts Custom Tooltip Component
    const CustomRechartsTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div className="custom-chart-tooltip">
                    <p className="tooltip-label">{label}</p>
                    <p className="tooltip-value">
                        {payload[0].value.toLocaleString('es-ES', { minimumFractionDigits: 1 })} horas
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="project-analytics-dashboard">
            {/* Header Section */}
            <header className="analytics-header">
                <div className="header-left">
                    <h1>Dashboard de Analítica de Proyectos</h1>
                    <span className="date-badge">
                        {new Date(fromDate + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })} - {new Date(toDate + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                </div>
            </header>

            {/* Controls Panel */}
            <section className="analytics-controls">
                <div className="date-preset-buttons">
                    <button className={`preset-btn ${activePreset === 'today' ? 'active' : ''}`} onClick={() => applyPreset('today')}>Hoy</button>
                    <button className={`preset-btn ${activePreset === 'yesterday' ? 'active' : ''}`} onClick={() => applyPreset('yesterday')}>Ayer</button>
                    <button className={`preset-btn ${activePreset === 'last-7' ? 'active' : ''}`} onClick={() => applyPreset('last-7')}>Últimos 7 Días</button>
                    <button className={`preset-btn ${activePreset === 'last-30' ? 'active' : ''}`} onClick={() => applyPreset('last-30')}>Últimos 30 Días</button>
                    <button className={`preset-btn ${activePreset === 'current-month' ? 'active' : ''}`} onClick={() => applyPreset('current-month')}>Mes Actual</button>
                </div>

                <div className="filters-row">
                    <div className="filter-group">
                        <label>Desde</label>
                        <input type="date" value={fromDate} onChange={(e) => handleCustomDateChange('from', e.target.value)} />
                    </div>
                    <div className="filter-group">
                        <label>Hasta</label>
                        <input type="date" value={toDate} onChange={(e) => handleCustomDateChange('to', e.target.value)} />
                    </div>
                    <div className="filter-group">
                        <label>Equipo</label>
                        <select value={selectedTeam} onChange={(e) => { setSelectedTeam(e.target.value); setSelectedEmployee(''); }}>
                            <option value="">Todos los Equipos</option>
                            {filterOptions.teams.map((t, idx) => (
                                <option key={idx} value={t}>{t}</option>
                            ))}
                        </select>
                    </div>
                    <div className="filter-group">
                        <label>Agente / Empleado</label>
                        <select value={selectedEmployee} onChange={(e) => setSelectedEmployee(e.target.value)}>
                            <option value="">Todos los Agentes</option>
                            {filterOptions.employees.map((emp) => (
                                <option key={emp.id} value={emp.name}>{emp.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="filter-group">
                        <label>Proyecto</label>
                        <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}>
                            <option value="">Todos los Proyectos</option>
                            {filterOptions.projects.map((p, idx) => (
                                <option key={idx} value={p}>{p}</option>
                            ))}
                        </select>
                    </div>
                    <div className="filter-group">
                        <label>Cuenta API</label>
                        <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}>
                            <option value="">Todas</option>
                            <option value="TN">TN</option>
                            <option value="BAY">BAY</option>
                        </select>
                    </div>
                </div>
            </section>

            {/* Error Display */}
            {error && <div className="analytics-error-message">⚠️ Error: {error}</div>}

            {/* Loading Display */}
            {loading ? (
                <div className="analytics-loading-overlay">
                    <div className="analytics-spinner"></div>
                    <p>Agregando métricas y generando gráficos...</p>
                </div>
            ) : (
                <>
                    {/* KPIs Cards */}
                    <section className="kpi-row">
                        <div className="kpi-card">
                            <div className="kpi-icon-wrapper">⏱️</div>
                            <div className="kpi-details">
                                <span className="kpi-label">Tiempo Total</span>
                                <span className="kpi-value">{formatDuration(kpis.total_duration)}</span>
                            </div>
                        </div>
                        <div className="kpi-card">
                            <div className="kpi-icon-wrapper">🏗️</div>
                            <div className="kpi-details">
                                <span className="kpi-label">Proyectos Activos</span>
                                <span className="kpi-value">{kpis.active_projects}</span>
                            </div>
                        </div>
                        <div className="kpi-card">
                            <div className="kpi-icon-wrapper">👥</div>
                            <div className="kpi-details">
                                <span className="kpi-label">Agentes Activos</span>
                                <span className="kpi-value">{kpis.active_agents}</span>
                            </div>
                        </div>
                        <div className="kpi-card">
                            <div className="kpi-icon-wrapper">📝</div>
                            <div className="kpi-details">
                                <span className="kpi-label">Tareas Registradas</span>
                                <span className="kpi-value">{kpis.active_tasks}</span>
                            </div>
                        </div>
                    </section>

                    {/* Primary Charts Row */}
                    <section className="charts-grid-main">
                        {/* Chart 1: Daily Trend */}
                        <div className="chart-card">
                            <div className="chart-header">
                                <h2>Evolución Diaria (Horas registradas)</h2>
                                <div className="chart-type-selector">
                                    <button className={`type-btn ${trendChartType === 'area' ? 'active' : ''}`} onClick={() => setTrendChartType('area')}>Área</button>
                                    <button className={`type-btn ${trendChartType === 'bar' ? 'active' : ''}`} onClick={() => setTrendChartType('bar')}>Barras</button>
                                    <button className={`type-btn ${trendChartType === 'line' ? 'active' : ''}`} onClick={() => setTrendChartType('line')}>Línea</button>
                                </div>
                            </div>
                            <div className="chart-wrapper">
                                {trendChartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={320}>
                                        {trendChartType === 'area' ? (
                                            <AreaChart data={trendChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                <defs>
                                                    <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#3182ce" stopOpacity={0.4}/>
                                                        <stop offset="95%" stopColor="#3182ce" stopOpacity={0.0}/>
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                                                <XAxis dataKey="date" stroke="#a0aec0" fontSize={11} tickLine={false} />
                                                <YAxis stroke="#a0aec0" fontSize={11} tickLine={false} axisLine={false} />
                                                <Tooltip content={<CustomRechartsTooltip />} />
                                                <Area type="monotone" dataKey="hours" stroke="#3182ce" strokeWidth={2.5} fillOpacity={1} fill="url(#colorTrend)" />
                                            </AreaChart>
                                        ) : trendChartType === 'bar' ? (
                                            <BarChart data={trendChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                                                <XAxis dataKey="date" stroke="#a0aec0" fontSize={11} tickLine={false} />
                                                <YAxis stroke="#a0aec0" fontSize={11} tickLine={false} axisLine={false} />
                                                <Tooltip content={<CustomRechartsTooltip />} />
                                                <Bar dataKey="hours" fill="#3182ce" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        ) : (
                                            <LineChart data={trendChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                                                <XAxis dataKey="date" stroke="#a0aec0" fontSize={11} tickLine={false} />
                                                <YAxis stroke="#a0aec0" fontSize={11} tickLine={false} axisLine={false} />
                                                <Tooltip content={<CustomRechartsTooltip />} />
                                                <Line type="monotone" dataKey="hours" stroke="#3182ce" strokeWidth={3} activeDot={{ r: 6 }} dot={{ r: 3 }} />
                                            </LineChart>
                                        )}
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="no-chart-data">Sin datos disponibles en este rango</p>
                                )}
                            </div>
                        </div>

                        {/* Chart 2: Projects Share */}
                        <div className="chart-card">
                            <div className="chart-header">
                                <h2>Distribución por Proyecto</h2>
                                <div className="chart-type-selector">
                                    <button className={`type-btn ${distributionChartType === 'bar' ? 'active' : ''}`} onClick={() => setDistributionChartType('bar')}>Barras</button>
                                    <button className={`type-btn ${distributionChartType === 'pie' ? 'active' : ''}`} onClick={() => setDistributionChartType('pie')}>Torta</button>
                                </div>
                            </div>
                            <div className="chart-wrapper">
                                {projectChartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={320}>
                                        {distributionChartType === 'bar' ? (
                                            <BarChart data={projectChartData} layout="vertical" margin={{ top: 5, right: 15, left: 10, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.05)" />
                                                <XAxis type="number" stroke="#a0aec0" fontSize={10} tickLine={false} axisLine={false} />
                                                <YAxis dataKey="name" type="category" stroke="#718096" fontSize={10.5} tickLine={false} width={110} />
                                                <Tooltip content={<CustomRechartsTooltip />} />
                                                <Bar dataKey="hours" fill="#319795" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        ) : (
                                            <PieChart>
                                                <Pie
                                                    data={projectChartData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={60}
                                                    outerRadius={95}
                                                    paddingAngle={2}
                                                    dataKey="hours"
                                                >
                                                    {projectChartData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip content={<CustomRechartsTooltip />} />
                                                <Legend wrapperStyle={{ fontSize: 9.5, paddingTop: 10 }} layout="horizontal" verticalAlign="bottom" align="center" iconSize={8} />
                                            </PieChart>
                                        )}
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="no-chart-data">Sin datos disponibles en este rango</p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Secondary Charts Row */}
                    <section className="charts-grid-secondary">
                        {/* Chart 3: Top Productive Agents */}
                        <div className="chart-card">
                            <div className="chart-header">
                                <h2>Top 10 Agentes más Productivos</h2>
                            </div>
                            <div className="chart-wrapper">
                                {agentChartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={320}>
                                        <BarChart data={agentChartData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                                            <XAxis dataKey="name" stroke="#a0aec0" fontSize={10} tickLine={false} interval={0} tick={{ angle: -25, textAnchor: 'end', dy: 5 }} height={55} />
                                            <YAxis stroke="#a0aec0" fontSize={10} tickLine={false} axisLine={false} />
                                            <Tooltip content={<CustomRechartsTooltip />} />
                                            <Bar dataKey="hours" fill="#805ad5" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="no-chart-data">Sin datos de agentes</p>
                                )}
                            </div>
                        </div>

                        {/* Chart 4: Teams Performance share */}
                        <div className="chart-card">
                            <div className="chart-header">
                                <h2>Distribución por Equipo</h2>
                            </div>
                            <div className="chart-wrapper">
                                {teamChartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={320}>
                                        <PieChart>
                                            <Pie
                                                data={teamChartData}
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={100}
                                                paddingAngle={3}
                                                dataKey="hours"
                                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                                labelLine={false}
                                            >
                                                {teamChartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={CHART_COLORS[(index + 3) % CHART_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip content={<CustomRechartsTooltip />} />
                                            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 10 }} layout="horizontal" verticalAlign="bottom" align="center" iconSize={8} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="no-chart-data">Sin datos de equipos</p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Data Details Table Card */}
                    <section className="table-card">
                        <div className="table-header">
                            <h2>Desglose de Horas por Tarea / Actividad</h2>
                            <div className="table-actions">
                                <div className="search-input-wrapper">
                                    <span className="search-icon">🔍</span>
                                    <input 
                                        type="text" 
                                        placeholder="Filtrar por proyecto o tarea..." 
                                        value={tableSearch}
                                        onChange={(e) => setTableSearch(e.target.value)}
                                    />
                                </div>
                                <button className="btn-export-csv" onClick={exportCSV} disabled={tableData.length === 0}>
                                    📄 Exportar CSV
                                </button>
                            </div>
                        </div>

                        <div className="analytics-table-container">
                            <table className="analytics-table">
                                <thead>
                                    <tr>
                                        <th>Proyecto</th>
                                        <th>Tarea / Descripción</th>
                                        <th style={{ textAlign: 'right' }}>Tiempo Invertido</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedTableData.length > 0 ? (
                                        paginatedTableData.map((row, idx) => (
                                            <tr key={idx}>
                                                <td><strong>{row.project}</strong></td>
                                                <td>{row.name}</td>
                                                <td className="task-duration-col" style={{ textAlign: 'right' }}>
                                                    {formatDuration(row.value)}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan="3" className="no-data" style={{ textAlign: 'center', padding: '2rem', color: '#a0aec0' }}>
                                                No se encontraron tareas registradas con los filtros actuales.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Table Pagination */}
                        {totalPages > 1 && (
                            <div className="table-pagination">
                                <div className="page-info">
                                    Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong> (Mostrando {tableData.length} registros)
                                </div>
                                <div className="page-controls">
                                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
                                        Anterior
                                    </button>
                                    <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                                        Siguiente
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
};

export default ProjectAnalyticsDashboard;
