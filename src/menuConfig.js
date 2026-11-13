/**
 * Single source of truth for the sidebar navigation.
 *
 * Both the sidebar (App.jsx) and the role permissions grid (LoginManagement.jsx)
 * read from here, so a new sub-menu shows up in both places at once instead of
 * having to be added twice by hand.
 *
 * `icon` is a key into the Icons map in App.jsx (the SVG lives there, not here,
 * so this file stays plain data and can be imported anywhere).
 * `permLabel` overrides the label shown in the permissions grid, for entries
 * whose sidebar label only makes sense nested under its parent.
 */
export const MENU_SECTIONS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'Dashboard',
    submenu: [
      { id: 'dashboard', label: 'Real Time' },
      { id: 'infograph', label: 'Infograph' },
      { id: 'project-analytics', label: 'Projects & Task' }
    ]
  },
  {
    id: 'employees',
    label: 'Employees',
    icon: 'Users',
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
    icon: 'Reports',
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
    icon: 'Calendar',
    submenu: [
      { id: 'schedule-board', label: 'Schedule Board' },
      { id: 'shift-management', label: 'Shift Management' },
      { id: 'forecast', label: 'Forecast' },
      { id: 'holidays', label: 'Holidays' },
      { id: 'coverage', label: 'Coverage' },
      { id: 'time-off', label: 'Time Off & Availability' },
      { id: 'templates', label: 'Templates' },
      { id: 'shift-swaps', label: 'Shift Swaps' },
      { id: 'history', label: 'History' }
    ]
  },
  {
    id: 'hr',
    label: 'HR',
    icon: 'HR',
    submenu: [
      { id: 'bonus', label: 'Bonus' },
      { id: 'hr-milestones', label: 'Milestones' },
      { id: 'hr-history', label: 'History', permLabel: 'History (Bonus changes)' }
    ]
  },
  {
    id: 'settings',
    label: 'Configuration',
    icon: 'Settings',
    submenu: [
      { id: 'settings-dashboard', label: 'Dashboard', permLabel: 'Dashboard Settings' },
      { id: 'settings-reports', label: 'Reports', permLabel: 'Report Settings' },
      { id: 'settings-scheduling', label: 'Scheduling', permLabel: 'Scheduling Settings' },
      { id: 'settings-hr', label: 'HR', permLabel: 'HR Settings' },
      { id: 'settings-desktime-api', label: 'Desktime API', permLabel: 'Desktime API (keys)' },
      { id: 'org', label: 'Organization' },
      { id: 'login-mgmt', label: 'User', permLabel: 'User (Users & Roles)' },
      { id: 'shift-types', label: 'Shift Types' },
      { id: 'abs-types', label: 'Absence Types' },
      { id: 'notifications', label: 'Notifications' },
      { id: 'change-password', label: 'Password' },
      { id: 'toggle-theme', label: 'Switch Theme' }
    ]
  }
]

/**
 * Entries every user gets regardless of role: self-service or cosmetic screens.
 * They are never role-gated, so they are also left out of the permissions grid.
 * Databases is deliberately NOT here -- raw table access is a per-role decision.
 */
export const ALWAYS_ALLOWED = new Set(['toggle-theme', 'change-password'])

/**
 * Flat list of every role-gated sub-menu, tagged with its parent section.
 * This is what the Modules tab in Configuration -> User -> Roles renders.
 */
export const PERMISSION_MODULES = MENU_SECTIONS.flatMap(section =>
  section.submenu
    .filter(sub => !ALWAYS_ALLOWED.has(sub.id))
    .map(sub => ({
      id: sub.id,
      label: sub.permLabel || sub.label,
      category: section.label
    }))
)
