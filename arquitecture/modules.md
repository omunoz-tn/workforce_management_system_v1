# Modules

## Dashboard
- **Purpose**: High-level overview of operations, live metrics, and team status.
- **Features**: Real-time stats, team filtering, today's summary.
- **KPIs**: Total Employees, Online, Offline, Late Arrivals.
- **Tables**: None directly on the main dashboard overview, relies on drill-downs.
- **Charts/graphs**: Attendance breakdown, productivity gauges (implied).
- **Filters**: Date range, team/group selector.
- **User Actions**: View drill-downs, change date range.

## Employees (Roster & Teams)
- **Purpose**: Manage employee records, team assignments, and organizational structure.
- **Features**: All Employees list (Desktime), Employee Roster, Team Management, Billable status management.
- **KPIs**: Headcount, billable vs non-billable ratio.
- **Tables**:
  - Employee Table: Name, Team, Status, Role, Email.
  - Teams Table: Team Name, Parent Group, Manager, Headcount.
- **User Actions**: Assign employees to teams, edit team hierarchy, toggle billable status.

## Analytics & Reports
- **Purpose**: Historical data analysis, hour tracking, and project reporting.
- **Features**: Hours Report, KPI Stat Reports, Employee Projects Report, Save Hours, Save Projects.
- **KPIs**: Total Hours, Avg Hours/Emp, Target Adherence.
- **Tables**:
  - Hours Report: Employee, Team, Daily Hours (matrix), Total Hours.
- **Filters**: Year, Week, Active Only, Adjusted/Real view.
- **User Actions**: Export CSV, toggle adjusted hours view.

## Scheduling (WFM)
- **Purpose**: Forecast, plan, and monitor employee schedules and adherence.
- **Features**: Schedule Board, Shift Management, Forecasting, Coverage (Planned).
- **KPIs**: Scheduled Hours, Adherence %, Coverage gaps.
- **Tables**:
  - Schedule Matrix: Employee, Date (columns), Shift times.
- **User Actions**: Edit shifts, swap shifts, manage time off.

## Settings (Admin)
- **Purpose**: Platform configuration and user management.
- **Features**: User Roles/Login Management, Org Settings, Report Settings, Theme Toggle.
- **User Actions**: Create users, map roles to teams, configure system defaults.
