<?php
/**
 * DesktimeApiKeys.php
 * Where FOCUS gets its DeskTime API keys from.
 *
 * The keys used to come only from .env (DESKTIME_API_KEY_TN, DESKTIME_API_KEY_BAY). They are
 * now edited from Configuration > Desktime API and stored in platform_settings under
 * `desktime_api_keys`, as the same text the .env holds -- one `DESKTIME_API_KEY_<ACCOUNT>=<key>`
 * per line -- so what an admin pastes there is exactly what they would have put in the file.
 *
 * Precedence: a saved configuration replaces every DESKTIME_API_KEY_* that .env (or the
 * process environment) set; with nothing saved, the .env values stay in force. Rotating a key
 * therefore takes effect on the next request, with no file edit and no container restart.
 *
 * Accounts are read from the key names, so a third account is one more line here -- every
 * sync loops over desktimeAccounts() instead of a hard-coded TN/BAY pair.
 */

const DESKTIME_API_KEYS_SETTING = 'desktime_api_keys';
const DESKTIME_API_KEY_PREFIX = 'DESKTIME_API_KEY_';

/** The .env's own keys, captured before the configuration overrides them. */
$GLOBALS['DESKTIME_API_KEYS_FROM_ENV'] = [];
$GLOBALS['DESKTIME_API_KEYS_SOURCE'] = 'env';

/**
 * Parses the textbox / setting text into [ACCOUNT => key], in the order written.
 * Blank lines and `#` comments are skipped. Throws InvalidArgumentException naming the first
 * line that is not `DESKTIME_API_KEY_<ACCOUNT>=<key>`, so a typo is refused instead of
 * silently dropping an account from the sync.
 */
function desktimeParseApiKeysText(string $text): array
{
    $accounts = [];
    $lines = preg_split('/\r\n|\r|\n/', $text);
    foreach ($lines as $index => $rawLine) {
        $line = trim($rawLine);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        $lineNumber = $index + 1;
        $parts = explode('=', $line, 2);
        if (count($parts) !== 2) {
            throw new InvalidArgumentException("Line {$lineNumber}: expected DESKTIME_API_KEY_<ACCOUNT>=<key>.");
        }
        $name = strtoupper(trim($parts[0]));
        $key = trim(trim($parts[1]), "\"'");
        if (strpos($name, DESKTIME_API_KEY_PREFIX) !== 0 || strlen($name) === strlen(DESKTIME_API_KEY_PREFIX)) {
            throw new InvalidArgumentException("Line {$lineNumber}: the name must start with DESKTIME_API_KEY_ followed by the account (e.g. DESKTIME_API_KEY_TN).");
        }
        $account = substr($name, strlen(DESKTIME_API_KEY_PREFIX));
        if (!preg_match('/^[A-Z0-9_]+$/', $account)) {
            throw new InvalidArgumentException("Line {$lineNumber}: the account name may only use letters, digits and _.");
        }
        if ($key === '') {
            throw new InvalidArgumentException("Line {$lineNumber}: {$name} has no key.");
        }
        if (preg_match('/\s/', $key)) {
            throw new InvalidArgumentException("Line {$lineNumber}: the key for {$name} contains spaces.");
        }
        if (isset($accounts[$account])) {
            throw new InvalidArgumentException("Line {$lineNumber}: {$name} appears more than once.");
        }
        $accounts[$account] = $key;
    }
    return $accounts;
}

/** [ACCOUNT => key] back into the .env-style text the textbox shows. */
function desktimeApiKeysToText(array $accounts): string
{
    $lines = [];
    foreach ($accounts as $account => $key) {
        $lines[] = DESKTIME_API_KEY_PREFIX . $account . '=' . $key;
    }
    return implode("\n", $lines);
}

/** Every DESKTIME_API_KEY_* in $env as [ACCOUNT => key], TN and BAY first as before. */
function desktimeAccounts(array $env): array
{
    $accounts = [];
    foreach ($env as $name => $value) {
        if (strpos($name, DESKTIME_API_KEY_PREFIX) === 0 && strlen($name) > strlen(DESKTIME_API_KEY_PREFIX)) {
            $accounts[substr($name, strlen(DESKTIME_API_KEY_PREFIX))] = ($value === '' ? null : $value);
        }
    }
    $ordered = [];
    foreach (['TN', 'BAY'] as $first) {
        if (array_key_exists($first, $accounts)) {
            $ordered[$first] = $accounts[$first];
            unset($accounts[$first]);
        }
    }
    return $ordered + $accounts;
}

/** The saved text, or null when nothing is saved (or the table does not exist yet). */
function desktimeStoredApiKeysText(PDO $pdo): ?array
{
    try {
        $stmt = $pdo->prepare('SELECT setting_value, updated_at FROM platform_settings WHERE setting_key = ?');
        $stmt->execute([DESKTIME_API_KEYS_SETTING]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        return null; // platform_settings missing: keep the .env keys
    }
    if (!$row || trim((string) $row['setting_value']) === '') {
        return null;
    }
    return ['text' => (string) $row['setting_value'], 'updated_at' => $row['updated_at']];
}

/**
 * Called by db_wfm_config.php once the connection is up: swaps the .env's DeskTime keys for
 * the configured ones. A stored value that no longer parses is ignored (the .env keys stay)
 * rather than taking every sync down -- the save endpoint never stores one, so that only
 * happens if someone edits the row by hand.
 */
function desktimeApplyConfiguredApiKeys(PDO $pdo, array &$env): void
{
    $fromEnv = [];
    foreach ($env as $name => $value) {
        if (strpos($name, DESKTIME_API_KEY_PREFIX) === 0) {
            $fromEnv[$name] = $value;
        }
    }
    $GLOBALS['DESKTIME_API_KEYS_FROM_ENV'] = $fromEnv;
    $GLOBALS['DESKTIME_API_KEYS_SOURCE'] = 'env';

    $stored = desktimeStoredApiKeysText($pdo);
    if ($stored === null) {
        return;
    }
    try {
        $accounts = desktimeParseApiKeysText($stored['text']);
    } catch (InvalidArgumentException $e) {
        error_log('desktime_api_keys setting ignored: ' . $e->getMessage());
        return;
    }
    if (!$accounts) {
        return;
    }

    foreach (array_keys($fromEnv) as $name) {
        unset($env[$name]);
    }
    foreach ($accounts as $account => $key) {
        $env[DESKTIME_API_KEY_PREFIX . $account] = $key;
    }
    $GLOBALS['DESKTIME_API_KEYS_SOURCE'] = 'configuration';
}
