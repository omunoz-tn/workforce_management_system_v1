import { useState, useEffect } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import appLogo from './assets/logo.png'
import focusLogo from './assets/focus_logo.svg'
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
import AttendanceReportView from './components/AttendanceReportView'
import EmployeeProjectsReport from './components/EmployeeProjectsReport'
import SyncHistory from './components/SyncHistory'
import SaveProjects from './components/SaveProjects'
import ReportSettings from './components/ReportSettings'
import ScheduleSettings from './components/ScheduleSettings'
import HRSettings from './components/HRSettings'
import ScheduleBoard from './components/ScheduleBoard'
import ShiftManagement from './components/ShiftManagement'
import Login from './components/Login'
import LoginManagement from './components/LoginManagement'
import ProjectAnalyticsDashboard from './components/ProjectAnalyticsDashboard'
import DatabaseViewer from './components/DatabaseViewer'
import Infograph from './components/Infograph'
import OdooEmployees from './components/OdooEmployees'
import Holidays from './components/Holidays'
import BonusPrograms from './components/BonusPrograms'
import BonusHomeOffice from './components/BonusHomeOffice'
import HRHistory from './components/HRHistory'
import HRMilestones from './components/HRMilestones'
import ChangePassword from './components/ChangePassword'
import { MENU_SECTIONS, ALWAYS_ALLOWED } from './menuConfig'

// SVG Icons
const Icons = {
  Dashboard: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>,
  Users: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>,
  Reports: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>,
  Calendar: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>,
  HR: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><circle cx="8.5" cy="11" r="2.5"></circle><path d="M4.5 17a4 4 0 0 1 8 0"></path><line x1="16" y1="10" x2="19.5" y2="10"></line><line x1="16" y1="14" x2="19.5" y2="14"></line></svg>,
  Settings: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
};

// Sidebar tree, resolved from the shared menu config so the sidebar and the
// role permissions grid can never drift apart. Icons live here because they are JSX.
const MENU_ITEMS = MENU_SECTIONS.map(section => ({
  ...section,
  icon: Icons[section.icon]
}))

function App() {
  const [theme, setTheme] = useState('light')
  const [activeMenu, setActiveMenu] = useState(null)
  const [backendStatus, setBackendStatus] = useState('Checking backend...')
  const [currentView, setCurrentView] = useState('dashboard')
  // Employee handed from the Schedule Board to Shift Management, consumed once on arrival.
  const [pendingShiftEmployee, setPendingShiftEmployee] = useState(null)
  const [reportParams, setReportParams] = useState(null)
  const [isReportView, setIsReportView] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [syncToast, setSyncToast] = useState({ show: false, message: '', type: 'info', details: null });
  const [user, setUser] = useState(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAuthChecking, setIsAuthChecking] = useState(true)
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true)

  // Returns whether the navigation actually happened, so a caller that also hands state to
  // the next view (openShiftManagementFor below) does not do it when the user backs out of
  // the unsaved-changes prompt.
  const handleNavClick = (viewId) => {
    if (hasUnsavedChanges) {
      if (!window.confirm("You have unsaved changes. If you leave, your changes will be lost. Do you wish to continue?")) {
        return false;
      }
      setHasUnsavedChanges(false);
    }
    // Reaching Shift Management any other way must not reopen the last employee.
    if (viewId !== 'shift-management') setPendingShiftEmployee(null);
    setCurrentView(viewId);
    return true;
  }

  // Jumps from a Schedule Board row straight into that employee's schedule editor.
  const openShiftManagementFor = (employee) => {
    if (handleNavClick('shift-management')) setPendingShiftEmployee(employee);
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
  // This used to be `}, [])` with the isAuthenticated guard inside: the flag is false on
  // mount and the effect never re-ran, so the guard returned every time and the automatic
  // sync never fired once. It depends on the flag now.
  useEffect(() => {
    if (!isAuthenticated) return;

    // The day loop below can outlive a logout or an unmount; this keeps it from writing
    // toasts into a screen the user already left.
    let cancelled = false;

    // Reads a sync endpoint that is allowed to die server-side. A PHP fatal, a timeout or
    // a proxy cutting the request all answer with HTML, not JSON; parsing that used to
    // throw straight into the outer catch and abort everything after nothing more than a
    // console.error -- the first live failure looked, from the UI, like no sync had ever
    // started.
    const fetchSyncJson = async (url) => {
      const res = await fetch(url);
      const body = await res.text();
      try {
        return JSON.parse(body);
      } catch {
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 120) || 'empty response'}`);
      }
    };

    // Phase 1 -- the weekly Save Hours job: on Tue-Fri, the previous Mon-Sun week of hours
    // (no project data). Runs before the daily backfill because the two share one lock and
    // this one is bounded at ~100s, while the daily crawl can spend minutes per day; the
    // other order would leave the weekly job waiting for the next login.
    //
    // The server decides whether it is due and for which week -- the container clock is
    // UTC while the business week is America/Santo_Domingo, so a browser asking "is it
    // Tuesday?" would disagree by up to four hours around midnight.
    const runWeeklyHours = async (status) => {
      const weekly = status.weekly_hours;
      if (!weekly || !weekly.due) return null;

      const label = `${weekly.target_week} a ${weekly.week_end}`;

      setSyncToast({
        show: true,
        type: 'info',
        message: 'Sincronizando horas de la semana anterior...',
        details: `Semana ${label} (7 dias)`
      });

      let data;
      try {
        data = await fetchSyncJson('./api/sync_weekly_hours.php');
      } catch (err) {
        console.error('Weekly hours sync failed:', err);
        return { ok: false, label, detail: err.message };
      }

      // 'locked' means the daily crawl or another tab holds the lock; the rest mean the
      // week stopped being due between the status check and the call. None of them is a
      // failure, and none of them should put anything on screen.
      if (['locked', 'already_done', 'throttled', 'not_due'].includes(data.status)) {
        return null;
      }

      if (data.success && data.status === 'completed') {
        return {
          ok: true,
          label: `${data.week_start} a ${data.week_end}`,
          hours: data.hours_synced || 0,
          dropped: data.dropped_weeks || []
        };
      }

      return {
        ok: false,
        label,
        detail: (data.errors && data.errors[0]) || data.error || 'ver Sync History',
        dropped: data.dropped_weeks || []
      };
    };

    // Phase 2 -- the daily backfill: hours *and* project data, for the days still missing.
    const runDailyBackfill = async (status) => {
      const days = status.pending_days || [];
      if (days.length === 0) return null;

      let hours = 0;
      let projects = 0;
      const failed = [];

      // One request per day: the backend refuses to crawl a range in a single request,
      // and this way every finished day is logged even if the user closes the tab midway.
      for (let i = 0; i < days.length; i++) {
        if (cancelled) return null;
        const day = days[i];

        setSyncToast({
          show: true,
          type: 'info',
          message: days.length === 1
            ? 'Syncing pending data...'
            : `Syncing pending data (${i + 1} of ${days.length})...`,
          details: `Processing ${day}`
        });

        let data;
        try {
          data = await fetchSyncJson(`./api/sync_auto_background.php?date=${day}`);
        } catch (dayErr) {
          console.error(`Auto Sync failed for ${day}:`, dayErr);
          failed.push(day);
          continue; // one bad day must not cancel the remaining ones
        }

        // Another tab or another user holds the lock. Their run covers these same days,
        // so stop instead of queueing up behind it.
        if (data.status === 'locked') return null;

        if (data.success && data.status === 'completed') {
          hours += data.hours_synced || 0;
          projects += data.projects_synced || 0;
        } else if (data.status !== 'skipped') {
          failed.push(day);
        }
      }

      return { days, hours, projects, failed };
    };

    const runAutoSync = async () => {
      try {
        // Cheap DB-only check first, and it answers for both phases. The syncs themselves
        // cost real DeskTime requests, so neither must run just to find out there was
        // nothing to do.
        const statusRes = await fetch('./api/sync_status.php');
        const status = await statusRes.json();
        if (cancelled || !status.success) return;

        const weekly = await runWeeklyHours(status);
        if (cancelled) return;

        const daily = await runDailyBackfill(status);
        if (cancelled) return;

        // One toast for both phases. The toast has no auto-dismiss, so whatever is set
        // last is what the user reads -- reporting each phase as it finished would hide
        // the weekly result behind the daily one every time both had work to do.
        const lines = [];
        let type = 'success';

        if (weekly) {
          if (weekly.ok) {
            lines.push(`Horas de la semana ${weekly.label}: ${weekly.hours} registros.`);
          } else {
            type = 'error';
            lines.push(`Horas de la semana ${weekly.label} fallaron: ${weekly.detail}`);
          }
          // A week that went past its Tue-Fri window is dropped rather than carried
          // forward, so say so: recovering it means running Save Hours by hand.
          if (weekly.dropped && weekly.dropped.length > 0) {
            type = 'error';
            lines.push(`Semana(s) descartada(s): ${weekly.dropped.join(', ')}. Usar Save Hours para recuperarlas.`);
          }
        }

        if (daily) {
          if (daily.failed.length > 0) {
            type = 'error';
            lines.push(`${daily.failed.length} of ${daily.days.length} days failed (${daily.failed.join(', ')}). See Sync History.`);
          } else {
            const rangeLabel = daily.days.length === 1
              ? daily.days[0]
              : `${daily.days[0]} to ${daily.days[daily.days.length - 1]}`;
            lines.push(status.truncated
              ? `${rangeLabel}: ${daily.hours} Hours and ${daily.projects} Tasks updated. Older days fall outside the ${status.backfill_limit}-day automatic window - use Save Hours / Save Projects for those.`
              : `${rangeLabel}: ${daily.hours} Hours and ${daily.projects} Tasks updated.`);
          }
        }

        if (lines.length === 0) {
          // Nothing was pending in either phase; leave the screen alone.
          return;
        }

        setSyncToast({
          show: true,
          type,
          message: type === 'success'
            ? 'Sincronizacion automatica completada.'
            : 'Sincronizacion automatica con errores.',
          details: lines.join(' ')
        });
      } catch (err) {
        console.error("Auto Sync Error:", err);
      }
    };

    // Tiny delay to ensure app is ready
    const timer = setTimeout(runAutoSync, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isAuthenticated]);

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

    if (view === 'report-attendance') {
      return <AttendanceReportView
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
        // Self-service / utility screens are never role-gated
        if (ALWAYS_ALLOWED.has(sub.id)) return true;
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
            {isSidebarExpanded && <img src={focusLogo} alt="FOCUS" className="sidebar-focus-logo" />}
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
          <ScheduleBoard
            onEditSchedule={user?.permissions?.includes('shift-management') ? openShiftManagementFor : null}
          />
        ) : currentView === 'shift-management' ? (
          <ShiftManagement initialEmployee={pendingShiftEmployee} />
        ) : currentView === 'holidays' ? (
          <Holidays />
        ) : currentView === 'bonus' ? (
          <BonusPrograms onOpenBonus={(programId) => {
            if (programId === 'home-office-transportation') handleNavClick('bonus-home-office');
          }} />
        ) : currentView === 'bonus-home-office' ? (
          <BonusHomeOffice onBack={() => handleNavClick('bonus')} />
        ) : currentView === 'hr-milestones' ? (
          <HRMilestones />
        ) : currentView === 'hr-history' ? (
          <HRHistory />
        ) : currentView === 'reports' ? (
          <Reports onLaunchReport={(id, from, to) => {
            setReportParams({ id, from, to });
            if (id === 'employee-hours') {
              handleNavClick('report-hours');
            } else if (id === 'employee-projects') {
              handleNavClick('report-employee-projects');
            } else if (id === 'sync-history') {
              handleNavClick('report-sync-history');
            } else if (id === 'attendance') {
              handleNavClick('report-attendance');
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
        ) : currentView === 'report-attendance' ? (
          <AttendanceReportView
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
        ) : currentView === 'settings-hr' ? (
          <HRSettings />
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
              <span className="toast-icon">{syncToast.type === 'success' ? '✅' : syncToast.type === 'info' ? '🔄' : '⚠️'}</span>
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
