import { useState, useEffect } from 'react'
import './AllEmployees.css'
import LoadingScreen from './LoadingScreen'

function AllEmployees() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pagination, setPagination] = useState({
    currentPage: 1,
    pageSize: 10,
    totalRecords: 0,
    totalPages: 0
  })
  const [availableColumns, setAvailableColumns] = useState([])
  const [selectedColumns, setSelectedColumns] = useState([])
  const [showColumnSelector, setShowColumnSelector] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' })
  const [pageInput, setPageInput] = useState('1')

  // Draggable Modal State
  const [modalPos, setModalPos] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  // Fetch data from API
  const fetchEmployees = async (page = 1, columns = null, search = '') => {
    setLoading(true)
    setError(null)

    try {
      const columnsParam = columns && columns.length > 0 ? `&columns=${columns.join(',')}` : ''
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : ''
      const sortParam = `&sort=${sortConfig.key}&order=${sortConfig.direction}`
      const response = await fetch(`/api/get_employees.php?page=${page}&limit=${pagination.pageSize}${columnsParam}${searchParam}${sortParam}`)
      const result = await response.json()

      if (result.success) {
        setEmployees(result.data)
        setPagination(result.meta)

        // Set available columns on first load
        if (availableColumns.length === 0) {
          setAvailableColumns(result.availableColumns)
          setSelectedColumns(result.availableColumns) // Select all by default
        }
      } else {
        setError(result.error || 'Failed to fetch data')
      }
    } catch (err) {
      setError('Network error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // Debouncing search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // Sync page input with pagination state
  useEffect(() => {
    setPageInput(String(pagination.currentPage))
  }, [pagination.currentPage])

  // Fetch on mount and when debounced search, columns, or sort changes
  useEffect(() => {
    fetchEmployees(1, selectedColumns, debouncedSearchTerm)
  }, [debouncedSearchTerm, selectedColumns, sortConfig])

  // Handle page change
  const handlePageChange = (newPage) => {
    fetchEmployees(newPage, selectedColumns, debouncedSearchTerm)
  }

  const handlePageInputSubmit = () => {
    const newPage = parseInt(pageInput)
    if (isNaN(newPage) || newPage < 1) {
      setPageInput(String(pagination.currentPage))
      return
    }

    // Clamp to valid range
    const validatedPage = Math.min(Math.max(1, newPage), pagination.totalPages)
    if (validatedPage !== pagination.currentPage) {
      handlePageChange(validatedPage)
    } else {
      setPageInput(String(pagination.currentPage))
    }
  }

  const handlePageInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      handlePageInputSubmit()
    }
  }

  // Handle sort change
  const handleSort = (column) => {
    setSortConfig(prevConfig => ({
      key: column,
      direction: prevConfig.key === column && prevConfig.direction === 'asc' ? 'desc' : 'asc'
    }))
  }

  // Export to CSV functionality
  const exportToCSV = async () => {
    try {
      // Fetch ALL data without pagination limit (or a very high one) for export
      const columnsParam = selectedColumns.length > 0 ? `&columns=${selectedColumns.join(',')}` : ''
      const searchParam = debouncedSearchTerm ? `&search=${encodeURIComponent(debouncedSearchTerm)}` : ''
      const sortParam = `&sort=${sortConfig.key}&order=${sortConfig.direction}`

      // We'll request a high limit to get all filtered records
      const response = await fetch(`/api/get_employees.php?page=1&limit=10000${columnsParam}${searchParam}${sortParam}`)
      const result = await response.json()

      if (!result.success) throw new Error(result.error || 'Export failed')

      const data = result.data
      if (data.length === 0) {
        alert('No data available to export.')
        return
      }

      const headers = selectedColumns
      const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => {
          const val = row[header] ?? ''
          return `"${String(val).replace(/"/g, '""')}"`
        }).join(','))
      ].join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.setAttribute('href', url)
      link.setAttribute('download', `employees_export_${new Date().toISOString().slice(0, 10)}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      alert('Error exporting CSV: ' + err.message)
    }
  }

  // Handle column selection toggle
  const toggleColumn = (column) => {
    const isSelected = selectedColumns.includes(column)
    const nextSelection = isSelected
      ? selectedColumns.filter(col => col !== column)
      : [...selectedColumns, column]

    // Preserve original order from availableColumns
    const orderedSelection = availableColumns.filter(col => nextSelection.includes(col))
    setSelectedColumns(orderedSelection)
  }

  // Bulk selection actions
  const selectAllColumns = () => setSelectedColumns([...availableColumns])
  const deselectAllColumns = () => setSelectedColumns([])

  // Apply column selection - Not used anymore with live update
  const applyColumnSelection = () => {
    if (selectedColumns.length === 0) {
      alert('Please select at least one column')
      return
    }
    setShowColumnSelector(false)
  }

  // Draggable Logic
  const handleMouseDown = (e) => {
    // Only drag from header, not buttons
    if (e.target.tagName === 'BUTTON') return

    setIsDragging(true)
    setDragOffset({
      x: e.clientX - modalPos.x,
      y: e.clientY - modalPos.y
    })
    e.preventDefault()
  }

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return
      setModalPos({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragOffset])

  // Reset position when opening
  useEffect(() => {
    if (showColumnSelector) {
      setModalPos({ x: 0, y: 0 })
    }
  }, [showColumnSelector])

  return (
    <div className="all-employees-container">
      <LoadingScreen loading={loading} message="Loading Employees" />

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      {(employees.length > 0 || !loading) && (
        <>
          <header className="employees-header">
            <h1>All Employees (Desktime)</h1>
            <div className="header-controls">
              <div className="search-box">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                {searchTerm && (
                  <button
                    className="clear-search-btn"
                    onClick={() => setSearchTerm('')}
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                className="export-csv-btn"
                onClick={exportToCSV}
                title="Export filtered results to CSV"
              >
                📥 Export CSV
              </button>
              <button
                className="column-selector-btn"
                onClick={() => setShowColumnSelector(!showColumnSelector)}
              >
                ⚙️ Select Columns
              </button>
            </div>
          </header>

          {/* Column Selector Modal */}
          {showColumnSelector && (
            <div className="column-selector-modal" onClick={() => setShowColumnSelector(false)}>
              <div
                className={`modal-content ${isDragging ? 'dragging' : ''}`}
                style={{ transform: `translate(${modalPos.x}px, ${modalPos.y}px)` }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header" onMouseDown={handleMouseDown}>
                  <h3>Select Columns to Display</h3>
                  <div className="bulk-actions">
                    <button onClick={selectAllColumns} className="btn-text">Select All</button>
                    <button onClick={deselectAllColumns} className="btn-text">Deselect All</button>
                  </div>
                </div>
                <div className="column-checkboxes">
                  {availableColumns.map(column => (
                    <div
                      key={column}
                      className={`column-toggle-btn ${selectedColumns.includes(column) ? 'selected' : ''}`}
                      onClick={() => toggleColumn(column)}
                    >
                      {column}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Data Table */}
          <div className="table-container">
            {employees.length === 0 ? (
              <p>No employee data found.</p>
            ) : (
              <table className="employees-table">
                <thead>
                  <tr>
                    {selectedColumns.map(column => (
                      <th
                        key={column}
                        onClick={() => handleSort(column)}
                        className={`sortable-header ${sortConfig.key === column ? 'active' : ''}`}
                      >
                        <div className="header-content">
                          {column}
                          <span className="sort-indicator">
                            {sortConfig.key === column ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee, index) => (
                    <tr key={index}>
                      {selectedColumns.map(column => (
                        <td key={column}>{employee[column] ?? '-'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination Controls */}
          <div className="pagination-controls">
            <div className="pagination-info">
              Showing {employees.length} of {pagination.totalRecords} records
              (Page {pagination.currentPage} of {pagination.totalPages})
            </div>
            <div className="pagination-buttons">
              <button
                onClick={() => handlePageChange(pagination.currentPage - 1)}
                disabled={!pagination.hasPrevPage || loading}
                className="btn-pagination"
              >
                ← Previous
              </button>
              <div className="page-navigation">
                <span className="page-label">Page</span>
                <input
                  type="text"
                  className="page-input"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
                  onBlur={handlePageInputSubmit}
                  onKeyDown={handlePageInputKeyDown}
                />
                <span className="page-total">of {pagination.totalPages}</span>
              </div>
              <button
                onClick={() => handlePageChange(pagination.currentPage + 1)}
                disabled={!pagination.hasNextPage || loading}
                className="btn-pagination"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default AllEmployees
