<?php
/**
 * manage_desktime_api.php
 * Configuration > Desktime API: the DeskTime API keys FOCUS syncs with.
 *
 * GET                     -> { text, source, env_text, updated_at }
 *                            text is what is in force: the saved configuration, or the .env's
 *                            keys when nothing is saved yet (source says which).
 * POST { text }           -> validate and save. Empty text deletes the setting, so FOCUS
 *                            goes back to the .env keys.
 * POST { action: 'test', text } -> ask DeskTime whether each key in text is accepted,
 *                            without saving anything.
 *
 * The keys are secrets, so the whole endpoint sits behind the screen's own permission.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';

session_start();
require_menu_access(['settings-desktime-api']);
session_write_close();

function desktimeEnsureSettingsTable(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `platform_settings` (
          `setting_key` varchar(64) NOT NULL,
          `setting_value` text DEFAULT NULL,
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`setting_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");
}

/** One cheap authenticated call per key; DeskTime answers 401 "API Key is invalid" when it is not. */
function desktimeProbeKey(string $key): array
{
    $ch = curl_init('https://desktime.com/api/v2/json/company?apiKey=' . urlencode($key));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    $decoded = json_decode((string) $response, true);
    if ($httpCode === 200 && !$curlError && is_array($decoded) && !isset($decoded['error'])) {
        return ['ok' => true, 'company' => $decoded['name'] ?? null];
    }
    $message = $curlError ?: '';
    if (isset($decoded['error']['description'])) {
        $message = $decoded['error']['description'];
    } elseif (isset($decoded['error']) && is_string($decoded['error'])) {
        $message = $decoded['error'];
    }
    return ['ok' => false, 'error' => trim('HTTP ' . $httpCode . ($message !== '' ? ' - ' . $message : ''))];
}

$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($method === 'GET') {
        $envText = desktimeApiKeysToText(desktimeAccounts($GLOBALS['DESKTIME_API_KEYS_FROM_ENV']));
        $stored = desktimeStoredApiKeysText($pdo);
        echo json_encode([
            'success' => true,
            'source' => $GLOBALS['DESKTIME_API_KEYS_SOURCE'],
            'text' => $stored !== null ? $stored['text'] : $envText,
            'env_text' => $envText,
            'updated_at' => $stored['updated_at'] ?? null
        ]);
        exit;
    }

    if ($method !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'error' => 'Method not allowed']);
        exit;
    }

    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $text = str_replace(["\r\n", "\r"], "\n", (string) ($data['text'] ?? ''));
    $accounts = desktimeParseApiKeysText($text);

    if (($data['action'] ?? '') === 'test') {
        if (!$accounts) {
            throw new InvalidArgumentException('There are no keys to test.');
        }
        $results = [];
        foreach ($accounts as $account => $key) {
            $results[] = ['account' => $account] + desktimeProbeKey($key);
        }
        echo json_encode(['success' => true, 'results' => $results]);
        exit;
    }

    desktimeEnsureSettingsTable($pdo);

    if (!$accounts) {
        $pdo->prepare('DELETE FROM platform_settings WHERE setting_key = ?')->execute([DESKTIME_API_KEYS_SETTING]);
        $envText = desktimeApiKeysToText(desktimeAccounts($GLOBALS['DESKTIME_API_KEYS_FROM_ENV']));
        echo json_encode(['success' => true, 'source' => 'env', 'text' => $envText, 'updated_at' => null]);
        exit;
    }

    // Stored as typed (comments and order kept) so the box shows back exactly what was saved.
    $clean = trim($text);
    $pdo->prepare(
        'INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
    )->execute([DESKTIME_API_KEYS_SETTING, $clean]);

    $stored = desktimeStoredApiKeysText($pdo);
    echo json_encode([
        'success' => true,
        'source' => 'configuration',
        'text' => $clean,
        'accounts' => array_keys($accounts),
        'updated_at' => $stored['updated_at'] ?? null
    ]);
} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
