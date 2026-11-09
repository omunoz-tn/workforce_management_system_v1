<?php
/**
 * UserPresence.php
 * Who is logged in to the platform right now (sidebar status dot, admin tooltip).
 *
 * Every open tab of a logged-in user pings user_presence.php every minute; a user counts
 * as online while their last ping is younger than USER_PRESENCE_ONLINE_SECONDS. Logout
 * removes the row, so the user drops off at once instead of after the window.
 *
 * Both the write and the age check use the DB clock (NOW()), never PHP's: the two are in
 * different time zones and the gap moves with DST (see get_online_employees.php).
 */

const USER_PRESENCE_ONLINE_SECONDS = 180;

function ensureUserPresenceTable(PDO $pdo): void
{
    static $done = false;
    if ($done) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS platform_user_presence (
        user_id INT NOT NULL PRIMARY KEY,
        last_seen_at DATETIME NOT NULL,
        KEY idx_last_seen (last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $done = true;
}

function touchUserPresence(PDO $pdo, int $userId): void
{
    ensureUserPresenceTable($pdo);
    $pdo->prepare("INSERT INTO platform_user_presence (user_id, last_seen_at) VALUES (?, NOW())
                   ON DUPLICATE KEY UPDATE last_seen_at = NOW()")
        ->execute([$userId]);
}

function clearUserPresence(PDO $pdo, int $userId): void
{
    ensureUserPresenceTable($pdo);
    $pdo->prepare("DELETE FROM platform_user_presence WHERE user_id = ?")->execute([$userId]);
}

/** Active accounts seen within the online window, most recent first. */
function fetchOnlineUsers(PDO $pdo): array
{
    ensureUserPresenceTable($pdo);
    $stmt = $pdo->prepare("SELECT u.id, u.username, u.full_name, r.name AS role,
                                  TIMESTAMPDIFF(SECOND, p.last_seen_at, NOW()) AS seconds_ago
                           FROM platform_user_presence p
                           JOIN platform_users u ON u.id = p.user_id AND u.status = 'active'
                           LEFT JOIN platform_roles r ON r.id = u.role_id
                           WHERE p.last_seen_at >= NOW() - INTERVAL ? SECOND
                           ORDER BY p.last_seen_at DESC");
    $stmt->execute([USER_PRESENCE_ONLINE_SECONDS]);
    return array_map(fn($r) => [
        'id' => (int) $r['id'],
        'username' => $r['username'],
        'full_name' => $r['full_name'],
        'role' => $r['role'],
        'seconds_ago' => (int) $r['seconds_ago'],
    ], $stmt->fetchAll(PDO::FETCH_ASSOC));
}
