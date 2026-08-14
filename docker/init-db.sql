-- Initial Database Schema for Workforce Platform

CREATE TABLE IF NOT EXISTS `teams` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `parent_id` int(11) DEFAULT NULL,
  `api_account` enum('TN','BAY') DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `parent_id` (`parent_id`),
  CONSTRAINT `teams_ibfk_1` FOREIGN KEY (`parent_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `desktime_employee_data` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `group_id` int(11) DEFAULT NULL,
  `group_name` varchar(100) DEFAULT NULL,
  `team_id` int(11) DEFAULT NULL,
  `profile_url` varchar(255) DEFAULT NULL,
  `is_online` tinyint(1) DEFAULT NULL,
  `arrived` datetime DEFAULT NULL,
  `left_time` datetime DEFAULT NULL,
  `is_late` tinyint(1) DEFAULT NULL,
  `online_time` int(11) DEFAULT NULL,
  `offline_time` int(11) DEFAULT NULL,
  `desktime_time` int(11) DEFAULT NULL,
  `at_work_time` int(11) DEFAULT NULL,
  `after_work_time` int(11) DEFAULT NULL,
  `before_work_time` int(11) DEFAULT NULL,
  `productive_time` int(11) DEFAULT NULL,
  `productivity` float DEFAULT NULL,
  `efficiency` float DEFAULT NULL,
  `work_starts` time DEFAULT NULL,
  `work_ends` time DEFAULT NULL,
  `slack_username` varchar(100) DEFAULT NULL,
  `timezone` varchar(100) DEFAULT NULL,
  `log_date` date NOT NULL,
  `api_account` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_billable` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_entry` (`employee_id`,`log_date`,`api_account`),
  KEY `fk_employee_team` (`team_id`),
  KEY `idx_log_date` (`log_date`),
  KEY `idx_group_name` (`group_name`),
  KEY `idx_is_online` (`is_online`),
  KEY `idx_composite_sync` (`log_date`,`updated_at`),
  CONSTRAINT `fk_employee_team` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `desktime_project_data` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `employee_name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `team_name` varchar(255) DEFAULT NULL,
  `project_id` int(11) DEFAULT NULL,
  `project_title` varchar(255) DEFAULT NULL,
  `task_id` int(11) DEFAULT NULL,
  `task_title` varchar(255) DEFAULT NULL,
  `duration_seconds` int(11) DEFAULT 0,
  `log_date` date NOT NULL,
  `api_account` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_task_entry` (`employee_id`,`log_date`,`project_id`,`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `desktime_sync_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sync_date` date NOT NULL,
  `status` enum('success','failure','skipped') NOT NULL,
  `hours_updated` int(11) DEFAULT 0,
  `projects_updated` int(11) DEFAULT 0,
  `error_message` text DEFAULT NULL,
  `sync_type` enum('manual','automatic') DEFAULT 'automatic',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `sync_date` (`sync_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `org_groups` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `is_visible` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `org_teams` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `group_id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `is_visible` tinyint(1) DEFAULT 1,
  `lunch_time` int(11) DEFAULT 0,
  `run_rate_time_source` enum('desktime_time','at_work_time') NOT NULL DEFAULT 'desktime_time',
  `exclude_lunch_from_run_rate` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `group_id` (`group_id`),
  CONSTRAINT `org_teams_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `org_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `org_team_assignments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `team_id` int(11) NOT NULL,
  `employee_id` int(11) NOT NULL,
  `assigned_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `team_id` (`team_id`,`employee_id`),
  CONSTRAINT `org_team_assignments_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `org_teams` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `org_team_managers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `target_type` enum('group','team') NOT NULL,
  `target_id` int(11) NOT NULL,
  `manager_name` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `org_schedule_forecast_overrides` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `employee_name` varchar(255) NOT NULL,
  `source_week_start` date NOT NULL,
  `target_end_week_start` date NOT NULL,
  `pattern` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_employee` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `org_run_rate_color_ranges` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `range_start` decimal(6,2) NOT NULL,
  `color` varchar(7) NOT NULL,
  `is_blinking` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_range_start` (`range_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `org_holidays` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `holiday_date` date NOT NULL,
  `country_code` varchar(2) NOT NULL,
  `holiday_type` enum('non_working','working','campaign_defined') NOT NULL DEFAULT 'non_working',
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_country_date` (`country_code`,`holiday_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Per-team override of a holiday's type. A row exists ONLY where a team differs from
-- org_holidays.holiday_type (the org-wide default), so a team with no row inherits it
-- and new holidays apply everywhere without fanning out a row per team.
-- Effective type = COALESCE(org_team_holiday_types.holiday_type, org_holidays.holiday_type)
CREATE TABLE IF NOT EXISTS `org_team_holiday_types` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `team_id` int(11) NOT NULL,
  `holiday_id` int(11) NOT NULL,
  `holiday_type` enum('non_working','working','campaign_defined') NOT NULL,
  -- Custom type only (enum value `campaign_defined`): this range is discounted from the
  -- team's SCHEDULED hours that day, so the Run Rate measures against a shorter window.
  -- The tracked hours from DeskTime are never modified. NULL means no time restriction.
  `exclude_from` time DEFAULT NULL,
  `exclude_to` time DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_team_holiday` (`team_id`,`holiday_id`),
  KEY `holiday_id` (`holiday_id`),
  CONSTRAINT `org_team_holiday_types_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `org_teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `org_team_holiday_types_ibfk_2` FOREIGN KEY (`holiday_id`) REFERENCES `org_holidays` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `org_holiday_type_colors` (
  `holiday_type` enum('non_working','working','campaign_defined') NOT NULL,
  `color` varchar(7) NOT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`holiday_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `org_holiday_type_colors` (`holiday_type`, `color`) VALUES
('non_working', '#dc2626'),
('working', '#16a34a'),
('campaign_defined', '#eab308');

CREATE TABLE IF NOT EXISTS `org_holiday_country_colors` (
  `country_code` varchar(2) NOT NULL,
  `color` varchar(7) NOT NULL,
  `text_color` varchar(7) NOT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`country_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `org_holiday_country_colors` (`country_code`, `color`, `text_color`) VALUES
('DO', '#2563eb', '#ffffff'),
('US', '#7c3aed', '#ffffff');

-- Employees excluded from Run Rate reporting (Configuration > Reports >
-- Advance Configuration > Run Rate Report > Employees Exceptions). Absence
-- from this table is the default (included); a row here is the exception.
CREATE TABLE IF NOT EXISTS `org_run_rate_excluded_employees` (
  `employee_id` int(11) NOT NULL,
  `excluded_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Specific calendar days excluded from a given team's Run Rate calculation
-- (Configuration > Reports > Advance Configuration > Run Rate Report > Days
-- Exceptions). Scoped per team_id, not global — the same date can be excluded
-- for one team (e.g. ACI) while still counting for another (e.g. Cherry).
CREATE TABLE IF NOT EXISTS `org_run_rate_excluded_days` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `team_id` int(11) NOT NULL,
  `excluded_date` date NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_team_date` (`team_id`,`excluded_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Specific calendar days excluded from a single EMPLOYEE's Run Rate (Days
-- Exceptions > By Employee) — unlike org_run_rate_excluded_days above, this
-- doesn't touch the rest of that employee's team.
CREATE TABLE IF NOT EXISTS `org_run_rate_excluded_employee_days` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `excluded_date` date NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_employee_date` (`employee_id`,`excluded_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Per-employee "Billable %" (Run Rate Report > Exceptions > Billable %).
-- Absence from this table means 100% (full hours count, unchanged). A stored
-- value scales BOTH actual and scheduled hours by the same factor before Run
-- Rate is computed — e.g. 50% turns a 7.99h/8h day into 3.995h/4h.
CREATE TABLE IF NOT EXISTS `org_run_rate_billable_percentage` (
  `employee_id` int(11) NOT NULL,
  `billable_percentage` decimal(5,2) NOT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `org_audit_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `target_type` enum('group','team') NOT NULL,
  `target_id` int(11) NOT NULL,
  `action` varchar(50) NOT NULL,
  `details` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
