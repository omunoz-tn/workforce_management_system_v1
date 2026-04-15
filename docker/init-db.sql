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

CREATE TABLE IF NOT EXISTS `org_audit_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `target_type` enum('group','team') NOT NULL,
  `target_id` int(11) NOT NULL,
  `action` varchar(50) NOT NULL,
  `details` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
