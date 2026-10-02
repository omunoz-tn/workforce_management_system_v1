<?php
/**
 * manage_hr_settings.php
 * The HR module's own preferences, edited from Configuration > HR.
 *
 * GET            -> every setting, with the value in force (stored, or the built-in default)
 * POST { bonus_worked_day_hours } -> store one
 *
 * Backed by `platform_settings`, the platform-wide key/value store — one row per setting,
 * absent until somebody changes it, which is what makes "reset to default" a DELETE rather
 * than a second column recording what the default used to be.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'BonusSql.php';
require_once 'BonusAudit.php';

// For the audit entry's author: this setting silently re-scores every month there is, so
// who changed it matters more than most edits on the Bonus list itself.
session_start();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    try {
        echo json_encode([
            'success' => true,
            'settings' => [
                'bonus_worked_day_hours' => bonusWorkedDayHours($pdo)
            ],
            'defaults' => [
                'bonus_worked_day_hours' => (float) BONUS_DEFAULT_WORKED_DAY_HOURS
            ],
            'limits' => [
                'bonus_worked_day_hours_max' => (float) BONUS_MAX_WORKED_DAY_HOURS
            ]
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];

    try {
        if (!array_key_exists('bonus_worked_day_hours', $data)) {
            throw new InvalidArgumentException('Nothing to update.');
        }

        // Reading it first creates platform_settings if this server never ran the migration,
        // so the write below cannot be the thing that discovers the table is missing.
        $previous = bonusWorkedDayHours($pdo);
        $hours = bonusNormalizeWorkedDayHours($data['bonus_worked_day_hours']);

        $stmt = $pdo->prepare(
            'INSERT INTO platform_settings (setting_key, setting_value)
             VALUES (:key, :value)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
        );
        $stmt->execute(['key' => BONUS_WORKED_DAY_HOURS_KEY, 'value' => (string) $hours]);

        if ($previous !== $hours) {
            bonusAuditLog($pdo, [
                'action' => 'setting',
                'field' => 'Worked day hours',
                'old_value' => (string) $previous,
                'new_value' => (string) $hours
            ]);
        }

        echo json_encode(['success' => true, 'bonus_worked_day_hours' => $hours]);
    } catch (InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
?>
