import { useState, useEffect } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import appLogo from './assets/logo.png'
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
import ScheduleSettings from './components/ScheduleSettings'
import ScheduleBoard from './components/ScheduleBoard'
import Login from './components/Login'
import LoginManagement from './components/LoginManagement'
import ProjectAnalyticsDashboard from './components/ProjectAnalyticsDashboard'
import DatabaseViewer from './components/DatabaseViewer'
import Infograph from './components/Infograph'
import OdooEmployees from './components/OdooEmployees'
import Holidays from './components/Holidays'
import ChangePassword from './components/ChangePassword'

// SVG Icons
const Icons = {
  Dashboard: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>,
  Users: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>,
  Reports: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>,
  Calendar: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>,
  Settings: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
};

// Placeholder Menu Data
const MENU_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: Icons.Dashboard,
    submenu: [
      { id: 'dashboard', label: 'Real Time' },
      { id: 'infograph', label: 'Infograph' },
      { id: 'project-analytics', label: 'Projects & Task' }
    ]
  },
  {
    id: 'employees',
    label: 'Employees',
    icon: Icons.Users,
    submenu: [
      { id: 'all-emp', label: 'All employees (Desktime)' },
      { id: 'odoo-emp', label: 'Employees (Odoo)' },
      { id: 'employee-roster', label: 'Employee Roster' },
      { id: 'teams', label: 'Teams' },
      { id: 'billable', label: 'Billable' }
    ]
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: Icons.Reports,
    submenu: [
      { id: 'reports', label: 'Reports' },
      { id: 'kpi', label: 'KPIs' },
      { id: 'databases', label: 'Databases' },
      { id: 'save-hours', label: 'Save Hours' },
      { id: 'save-projects', label: 'Save Projects & Task' }
    ]
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    icon: Icons.Calendar,
    submenu: [
      { id: 'schedule-board', label: 'Schedule Board' },
      { id: 'forecast', label: 'Forecast' },
      { id: 'holidays', label: 'Holidays' },
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
    label: 'Configuration',
    icon: Icons.Settings,
    submenu: [
      { id: 'settings-dashboard', label: 'Dashboard' },
      { id: 'settings-reports', label: 'Reports' },
      { id: 'settings-scheduling', label: 'Scheduling' },
      { id: 'org', label: 'Organization' },
      { id: 'login-mgmt', label: 'User' },
      { id: 'shift-types', label: 'Shift Types' },
      { id: 'abs-types', label: 'Absence Types' },
      { id: 'notifications', label: 'Notifications' },
      { id: 'change-password', label: 'Password' },
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
  const [user, setUser] = useState(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAuthChecking, setIsAuthChecking] = useState(true)
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true)

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

  // Backend & Session Check
  useEffect(() => {
    fetch('./api/auth.php?action=check')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setIsAuthenticated(true);
          setUser(data.user);
          setBackendStatus('Connected');
        } else {
          setBackendStatus(data.message || 'Connected');
        }
      })
      .catch(() => setBackendStatus('Backend Offline'))
      .finally(() => setIsAuthChecking(false));
  }, [])

  const handleLogout = async () => {
    try {
      await fetch('./api/auth.php?action=logout', { method: 'POST' });
      setIsAuthenticated(false);
      setUser(null);
      setCurrentView('dashboard');
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const handleLoginSuccess = (userData) => {
    setIsAuthenticated(true);
    setUser(userData);
  };

  // Automated Background Sync
  useEffect(() => {
    if (!isAuthenticated) return; // Only sync if logged in
    
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

  if (isAuthChecking) {
    return (
      <div className="loading-screen-full">
        <div className="spinner-large"></div>
        <p>Verifying Security Session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // Filter MENU_ITEMS based on user permissions
  const filteredMenuItems = MENU_ITEMS.map(item => {
    // If it's a parent with a submenu, filter the submenu
    if (item.submenu && item.submenu.length > 0) {
      const filteredSub = item.submenu.filter(sub => {
        // toggle-theme, databases, and change-password (self-service, not role-gated) are always allowed
        if (sub.id === 'toggle-theme' || sub.id === 'databases' || sub.id === 'change-password') return true;
        return user.permissions.includes(sub.id);
      });

      // If we filtered down to 1 item and its ID is the same as the parent's ID,
      // convert it to a single item with NO submenu for a cleaner UX
      if (filteredSub.length === 1 && filteredSub[0].id === item.id) {
        return { ...item, submenu: [] };
      }

      // Only keep the parent if it has allowed sub-items
      if (filteredSub.length > 0) {
        return { ...item, submenu: filteredSub };
      }
      return null;
    }
    // If it's a single item
    return user.permissions.includes(item.id) ? item : null;
  }).filter(Boolean);

  return (
    <div className={`app-container ${theme}`}>

      {/* SIDEBAR */}
      <aside className={`sidebar ${isSidebarExpanded ? 'expanded' : ''}`}>

        {/* LOGO SECTION */}
        <div className="logo-section" style={{ padding: isSidebarExpanded ? '20px' : '20px 10px', flexDirection: isSidebarExpanded ? 'row' : 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: isSidebarExpanded ? 'auto' : '100%', justifyContent: 'center' }}>
            <img src={appLogo} alt="Logo" width="34" className="sidebar-logo" />
            {isSidebarExpanded && <span className="sidebar-label" style={{ fontWeight: 'bold', fontSize: '1.2rem', color: 'var(--sidebar-text)', margin: 0, opacity: 1, pointerEvents: 'auto' }}>WFM</span>}
          </div>
          <button 
            onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
            style={{
              background: 'transparent', border: 'none', color: 'var(--sidebar-text)', opacity: 0.6, cursor: 'pointer', padding: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
              marginLeft: isSidebarExpanded ? 'auto' : '0', transition: 'opacity 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
            onMouseLeave={(e) => e.currentTarget.style.opacity = 0.6}
            title={isSidebarExpanded ? "Collapse Sidebar" : "Expand Sidebar"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              {isSidebarExpanded ? (
                <polygon points="16,4 16,20 6,12"></polygon>
              ) : (
                <polygon points="8,4 8,20 18,12"></polygon>
              )}
            </svg>
          </button>
          {!isSidebarExpanded && <div className="backend-indicator" title={backendStatus} style={{ 
            background: backendStatus === 'Connected' ? '#10b981' : '#f59e0b',
            top: '8px', right: '8px'
          }}></div>}
          {isSidebarExpanded && <div className="backend-indicator" title={backendStatus} style={{ 
            background: backendStatus === 'Connected' ? '#10b981' : '#f59e0b',
            position: 'static', marginLeft: '10px'
          }}></div>}
        </div>

        {/* MENU LIST */}
        <div className="menu-list" style={{ marginTop: '20px', flex: 1 }}>
          {filteredMenuItems.map((item) => {
            const isItemActive = currentView === item.id || item.submenu.some(sub => sub.id === currentView);
            const isSubmenuOpen = activeMenu === item.id || isItemActive;

            return (
              <div
                key={item.id}
                className={`menu-item ${isItemActive ? 'active' : ''}`}
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
                    style={{ display: isSubmenuOpen ? 'block' : 'none' }}
                  >
                    {item.submenu.map(sub =>
                      <div
                        key={sub.id}
                        className={`submenu-item ${currentView === sub.id ? 'active' : ''}`}
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
            );
          })}
        </div>


        {/* USER PROFILE & LOGOUT */}
        <div className="sidebar-footer">
          <div className="user-info-brief">
            <span className="user-avatar">👤</span>
            <div className="user-details">
              <span className="u-name">{user.full_name}</span>
              <span className="u-role">{user.role}</span>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            <span>Logout</span>
            <span className="logout-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </span>
          </button>
        </div>

      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        {currentView === 'dashboard' ? (
          <Dashboard />
        ) : currentView === 'all-emp' ? (
          <AllEmployees />
        ) : currentView === 'odoo-emp' ? (
          <OdooEmployees />
        ) : currentView === 'employee-roster' ? (
          <EmployeeRoster />
        ) : currentView === 'teams' ? (
          <Teams onUnsavedChanges={setHasUnsavedChanges} />
        ) : currentView === 'billable' ? (
          <BillableEmployees />
        ) : currentView === 'schedule-board' ? (
          <ScheduleBoard />
        ) : currentView === 'holidays' ? (
          <Holidays />
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
        ) : currentView === 'settings-scheduling' ? (
          <ScheduleSettings />
        ) : currentView === 'login-mgmt' ? (
          <LoginManagement />
        ) : currentView === 'change-password' ? (
          <ChangePassword user={user} />
        ) : currentView === 'project-analytics' ? (
          <ProjectAnalyticsDashboard />
        ) : currentView === 'infograph' ? (
          <Infograph />
        ) : currentView === 'databases' ? (
          <DatabaseViewer onBack={() => handleNavClick('reports')} />
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
