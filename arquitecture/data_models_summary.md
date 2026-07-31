# Data Models Summary

## org_groups & org_teams
- **Fields**: id, name, group_id (for teams), is_visible, lunch_time.
- **Relationships**: Teams belong to Groups.
- **Business Meaning**: Defines the business hierarchy and logical grouping of employees.

## platform_users & platform_roles
- **Fields**: id, username, password_hash, role_id, status.
- **Relationships**: Users have one Role. Roles map to permissions and allowed teams via `platform_permissions` and `platform_role_teams`.
- **Business Meaning**: Access control, authentication, and authorization layer.

## desktime_employee_data
- **Fields**: employee_id, log_date, name, email, desktime_time, total_time, group_name.
- **Relationships**: Can be mapped to internal teams via `org_team_assignments`.
- **Business Meaning**: Raw imported time-tracking data for attendance and daily hours calculations.

## desktime_project_data
- **Fields**: employee_id, log_date, project_name, duration_seconds.
- **Relationships**: Belongs to an employee (by employee_id).
- **Business Meaning**: Task-level breakdown of time spent, used for billable vs non-billable reporting.

## org_audit_log
- **Fields**: id, target_type, target_id, action, details, timestamp.
- **Business Meaning**: Security and compliance tracking of who changed what in the organization structure.
