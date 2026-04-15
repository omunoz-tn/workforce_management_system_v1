import { useState, useEffect } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import AllEmployees from './components/AllEmployees'
import Dashboard from './components/Dashboard'
import EmployeeRoster from './components/EmployeeRoster'
import Reports from './components/Reports'
import HoursReportView from './components/HoursReportView'
import SaveHours from './components/SaveHours'
import Teams from './components/Teams'
import DashboardSettings from './components/DashboardSettings'
import BillableEmployees from './components/BillableEmployees'
import StatReportView from './components/StatReportView'
import EmployeeProjectsReport from './components/EmployeeProjectsReport'
import SyncHistory from './components/SyncHistory'
import SaveProjects from './components/SaveProjects'
import ReportSettings from './components/ReportSettings'
import ScheduleBoard from './components/ScheduleBoard'

// Placeholder Menu Data
const MENU_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '📊',
    submenu: []
  },
  {
    id: 'employees',
    label: 'Employees',
    icon: '👥',
    submenu: [
      { id: 'all-emp', label: 'All employees (Desktime)' },
      { id: 'employee-roster', label: 'Employee Roster' },
      { id: 'teams', label: 'Teams' },
      { id: 'billable', label: 'Billable' }
    ]
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: '📈',
    submenu: [
      { id: 'reports', label: 'Reports' },
      { id: 'kpi', label: 'KPIs' },
      { id: 'save-hours', label: 'Save Hours' },
      { id: 'save-projects', label: 'Save Projects & Task' }
    ]
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    icon: '📅',
    submenu: [
      { id: 'schedule-board', label: 'Schedule Board' },
      { id: 'forecast', label: 'Forecast' },
      { id: 'coverage', label: 'Coverage' },
      { id: 'shift-mgmt', label: 'Shift Management' },
      { id: 'time-off', label: 'Time Off & Availability' },
      { id: 'templates', label: 'Templates' },
      { id: 'shift-swaps', label: 'Shift Swaps' },
      { id: 'history', label: 'History' }
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '⚙️',
    submenu: [
      { id: 'settings-dashboard', label: 'Dashboard' },
      { id: 'settings-reports', label: 'Reports' },
      { id: 'org', label: 'Organization' },
      { id: 'users', label: 'Users' },
      { id: 'roles', label: 'Roles' },
      { id: 'shift-types', label: 'Shift Types' },
      { id: 'abs-types', label: 'Absence Types' },
      { id: 'notifications', label: 'Notifications' },
      { id: 'toggle-theme', label: 'Switch Theme' }
    ]
  }
]

function App() {
  const [theme, setTheme] = useState('light')
  const [activeMenu, setActiveMenu] = useState(null)
  const [backendStatus, setBackendStatus] = useState('Checking backend...')
  const [currentView, setCurrentView] = useState('dashboard')
  const [reportParams, setReportParams] = useState(null)
  const [isReportView, setIsReportView] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [syncToast, setSyncToast] = useState({ show: false, message: '', type: 'info', details: null });

  const handleNavClick = (viewId) => {
    if (hasUnsavedChanges) {
      if (!window.confirm("You have unsaved changes. If you leave, your changes will be lost. Do you wish to continue?")) {
        return;
      }
      setHasUnsavedChanges(false);
    }
    setCurrentView(viewId);
  }

  // Check for report view in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'report-hours' || params.get('view')?.startsWith('report-')) {
      setIsReportView(true);
    }
  }, []);

  // Initialize Theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'light'
    setTheme(savedTheme)
    document.documentElement.className = savedTheme
  }, [])

  // Toggle Theme
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    document.documentElement.className = newTheme
  }

  // Backend Check
  useEffect(() => {
    fetch('./api/auth.php')
      .then(res => res.json())
      .then(data => setBackendStatus(data.message || 'Connected'))
      .catch(() => setBackendStatus('Backend Offline'))
  }, [])

  // Automated Background Sync
  useEffect(() => {
    const triggerSync = async () => {
      try {
        const response = await fetch('./api/sync_auto_background.php');
        const data = await response.json();
        
        if (data.success && data.status === 'completed') {
          setSyncToast({
            show: true,
            type: 'success',
            message: `Yesterday's data synced automatically.`,
            details: `${data.hours_synced} Hours and ${data.projects_synced} Tasks updated.`
          });
        } else if (!data.success) {
          setSyncToast({
            show: true,
            type: 'error',
            message: 'Background sync encountered an error.',
            details: data.error || 'Unknown error'
          });
        }
      } catch (err) {
        console.error("Auto Sync Error:", err);
      }
    };
    
    // Tiny delay to ensure app is ready
    const timer = setTimeout(triggerSync, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (isReportView) {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view') || '';
    if (view === 'report-hours') return <HoursReportView />;
    
    // Explicit check for Employee Projects to avoid falling into StatReportView
    if (view === 'report-employee-projects' || view.includes('employee-projects')) {
      return <EmployeeProjectsReport 
        fromDate={params.get('from')} 
        toDate={params.get('to')} 
        onBack={() => window.close()} 
      />;
    }

    if (view.startsWith('report-')) {
      return <StatReportView 
        reportId={view.replace('report-', '')} 
        fromDate={params.get('from')} 
        toDate={params.get('to')} 
        onBack={() => window.close()} 
      />;
    }
  }

  return (
    <div className={`app-container ${theme}`}>

      {/* SIDEBAR */}
      <aside className="sidebar">

        {/* LOGO SECTION */}
        <div className="logo-section" onClick={() => window.location.reload()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '15px' }}>
            <img src={viteLogo} alt="Logo" width="30" style={{ flexShrink: 0 }} />
            <span className="sidebar-label" style={{ fontWeight: 'bold', fontSize: '1.2em', whiteSpace: 'nowrap' }}>Workforce</span>
          </div>
        </div>

        {/* MENU LIST */}
        <div className="menu-list" style={{ marginTop: '20px' }}>
          {MENU_ITEMS.map((item) => (
            <div
              key={item.id}
              className="menu-item"
              onMouseEnter={() => setActiveMenu(item.id)}
              onMouseLeave={() => setActiveMenu(null)}
            >
              <div
                className="menu-item-header"
                onClick={() => item.submenu.length === 0 && handleNavClick(item.id)}
                style={{ cursor: item.submenu.length === 0 ? 'pointer' : 'default' }}
              >
                <span className="menu-icon">{item.icon}</span>
                <span className="sidebar-label">{item.label}</span>
                {item.submenu.length > 0 && <span className="sidebar-label submenu-arrow" style={{ fontSize: '0.8em', opacity: 0.6 }}>▼</span>}
              </div>

              {/* SUBMENU (Rendered if items exist) */}
              {item.submenu.length > 0 && (
                <div
                  className="submenu"
                  style={{ display: activeMenu === item.id ? 'block' : 'none' }}
                >
                  {item.submenu.map(sub =>
                    <div
                      key={sub.id}
                      className="submenu-item"
                      onClick={() => {
                        if (sub.id === 'toggle-theme') {
                          toggleTheme();
                        } else {
                          handleNavClick(sub.id);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {sub.label}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>


      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        {currentView === 'dashboard' ? (
          <Dashboard />
        ) : currentView === 'all-emp' ? (
          <AllEmployees />
        ) : currentView === 'employee-roster' ? (
          <EmployeeRoster />
        ) : currentView === 'teams' ? (
          <Teams onUnsavedChanges={setHasUnsavedChanges} />
        ) : currentView === 'billable' ? (
          <BillableEmployees />
        ) : currentView === 'schedule-board' ? (
          <ScheduleBoard />
        ) : currentView === 'reports' ? (
          <Reports onLaunchReport={(id, from, to) => {
            setReportParams({ id, from, to });
            if (id === 'employee-hours') {
              handleNavClick('report-hours');
            } else if (id === 'employee-projects') {
              handleNavClick('report-employee-projects');
            } else if (id === 'sync-history') {
              handleNavClick('report-sync-history');
            } else {
              handleNavClick('report-stat');
            }
          }} />
        ) : currentView === 'report-hours' ? (
          <HoursReportView
            fromDate={reportParams?.from}
            toDate={reportParams?.to}
            onBack={() => handleNavClick('reports')}
          />
        ) : currentView === 'report-employee-projects' ? (
          <EmployeeProjectsReport
            fromDate={reportParams?.from}
            toDate={reportParams?.to}
            onBack={() => handleNavClick('reports')}
          />
        ) : currentView === 'report-sync-history' ? (
          <SyncHistory onBack={() => handleNavClick('reports')} />
        ) : currentView === 'report-stat' ? (
          <StatReportView
            reportId={reportParams?.id}
            fromDate={reportParams?.from}
            toDate={reportParams?.to}
            onBack={() => handleNavClick('reports')}
          />
        ) : currentView === 'save-hours' ? (
          <SaveHours onBack={() => handleNavClick('dashboard')} />
        ) : currentView === 'save-projects' ? (
          <SaveProjects onBack={() => handleNavClick('dashboard')} />
        ) : currentView === 'settings-dashboard' ? (
          <DashboardSettings />
        ) : currentView === 'settings-reports' ? (
          <ReportSettings />
        ) : (
          <div className="placeholder-view">
            <header style={{ marginBottom: '2rem' }}>
              <h1>
                {MENU_ITEMS.find(i => i.id === currentView)?.label ||
                  MENU_ITEMS.flatMap(i => i.submenu).find(s => s?.id === currentView)?.label ||
                  'Page not found'}
              </h1>
              <p>This module is currently under development.</p>
            </header>
          </div>
        )
        }
      </main >

      {/* SYNC TOAST NOTIFICATION */}
      {syncToast.show && (
        <div className={`sync-toast ${syncToast.type}`}>
          <div className="toast-content">
            <div className="toast-header">
              <span className="toast-icon">{syncToast.type === 'success' ? '✅' : '⚠️'}</span>
              <strong>{syncToast.message}</strong>
              <button className="toast-close" onClick={() => setSyncToast({ ...syncToast, show: false })}>×</button>
            </div>
            {syncToast.details && <p className="toast-details">{syncToast.details}</p>}
          </div>
        </div>
      )}

    </div >
  )
}

export default App
