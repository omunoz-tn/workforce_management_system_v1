import { useState, useEffect } from 'react'
import './EmployeeRoster.css'
import LoadingScreen from './LoadingScreen'

function EmployeeRoster() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pagination, setPagination] = useState({
    currentPage: 1,
    pageSize: 15,
    totalRecords: 0,
    totalPages: 0
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' })

  const fetchRoster = async (page = 1, search = '') => {
    setLoading(true)
    setError(null)

    try {
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : ''
      const sortParam = `&sort=${sortConfig.key}&order=${sortConfig.direction}`
      const response = await fetch(`./api/get_employee_roster.php?page=${page}&limit=${pagination.pageSize}${searchParam}${sortParam}`)
      const result = await response.json()

      if (result.success) {
        setEmployees(result.data)
        setPagination(result.meta)
      } else {
        setError(result.error || 'Failed to fetch roster')
      }
    } catch (err) {
      setError('Network error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchTerm])

  useEffect(() => {
    fetchRoster(1, debouncedSearchTerm)
  }, [debouncedSearchTerm, sortConfig])

  const handlePageChange = (newPage) => {
    fetchRoster(newPage, debouncedSearchTerm)
  }

  const handleSort = (column) => {
    setSortConfig(prevConfig => ({
      key: column,
      direction: prevConfig.key === column && prevConfig.direction === 'asc' ? 'desc' : 'asc'
    }))
  }

  return (
    <div className="roster-container">
      <LoadingScreen loading={loading} message="Loading Roster" />

      <header className="roster-header">
        <div className="header-title">
          <h1>Employee Roster</h1>
          <p className="subtitle">Consolidated view of DeskTime and Hierarchy team assignments</p>
        </div>
        <div className="header-controls">
          <div className="search-box">
            <span className="search-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </span>
            <input
              type="text"
              placeholder="Search by name or team..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="table-responsive">
        <table className="roster-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('name')} className={`sortable-header ${sortConfig.key === 'name' ? 'active' : ''}`}>
                <div className="header-content">
                  Employee Name
                  <span className="sort-indicator">
                    {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                  </span>
                </div>
              </th>
              <th onClick={() => handleSort('desktime_group')} className={`sortable-header ${sortConfig.key === 'desktime_group' ? 'active' : ''}`}>
                <div className="header-content">
                  DeskTime Team
                  <span className="sort-indicator">
                    {sortConfig.key === 'desktime_group' ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                  </span>
                </div>
              </th>
              <th onClick={() => handleSort('hierarchy_team')} className={`sortable-header ${sortConfig.key === 'hierarchy_team' ? 'active' : ''}`}>
                <div className="header-content">
                  Hierarchy Team
                  <span className="sort-indicator">
                    {sortConfig.key === 'hierarchy_team' ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                  </span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {employees.length > 0 ? (
              employees.map((emp, idx) => (
                <tr key={idx}>
                  <td className="emp-name">{emp.name}</td>
                  <td>
                    <span className="team-badge desktime">{emp.desktime_group}</span>
                  </td>
                  <td>
                    <span className={`team-badge hierarchy ${emp.hierarchy_team ? '' : 'unassigned'}`}>
                      {emp.hierarchy_team || 'Unassigned'}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              !loading && (
                <tr>
                  <td colSpan="3" className="no-data">No employees found matching the criteria.</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <div className="pagination-info">
          Showing {employees.length} of {pagination.totalRecords} employees
        </div>
        <div className="pagination-actions">
          <button 
            disabled={pagination.currentPage === 1 || loading} 
            onClick={() => handlePageChange(pagination.currentPage - 1)}
          >
            Previous
          </button>
          <span className="current-page">Page {pagination.currentPage} of {pagination.totalPages}</span>
          <button 
            disabled={pagination.currentPage === pagination.totalPages || loading} 
            onClick={() => handlePageChange(pagination.currentPage + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

export default EmployeeRoster
