<?php
/**
 * manage_bonus_email.php
 * Configuration > HR > Bonus Approval Email: who is notified, and what they are sent.
 *
 * GET  -> the configuration in force, the variable list, and the defaults
 * POST { recipients?, subject?, body? }        -> store what was sent
 * POST { action: 'preview', year, month }      -> render it against a real month, send nothing
 * POST { action: 'reset',  target: 'subject'|'body'|'all' } -> forget the customisation
 *
 * A saved template is never overwritten by the default. Storing it and falling back to the
 * default only when nothing is stored is what makes that true by construction -- there is no
 * code path that writes the default over a customisation, because the default is never
 * written at all. "Reset to default" is a DELETE for the same reason.
 *
 * The body arrives as HTML from a rich-text box, so it is sanitised on the way in: the tags
 * a mail client will actually render, and nothing that executes.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'BonusSql.php';
require_once 'BonusApproval.php';
require_once 'BonusEmail.php';

session_start();

const BONUS_EMAIL_BONUS_NAME = 'Bonus Home Office / Transportation';

/**
 * Strips the body down to what an email can show.
 *
 * An allow-list, not a block-list: everything outside it goes, so a paste from Word or a
 * pasted <script> cannot reach a recipient's client. The permitted set is the formatting the
 * editor offers plus what a paste legitimately carries -- headings, emphasis, lists, links,
 * line breaks. Attributes are dropped entirely except href on a link, which is the one that
 * carries meaning; that also removes every on* handler and every style in one move.
 */
function bonusEmailSanitizeBody(string $html): string
{
    // Comments can hide markup from a naive tag filter, so they go first.
    $clean = preg_replace('/<!--.*?-->/s', '', $html);
    // Whole elements whose CONTENT is also unwanted, not just their tags.
    $clean = preg_replace('#<(script|style|iframe|object|embed|form)\b.*?</\1>#is', '', $clean);
    $clean = preg_replace('#<(script|style|iframe|object|embed|form)\b[^>]*/?>#i', '', $clean);

    $allowed = '<p><br><b><strong><i><em><u><ul><ol><li><a><h1><h2><h3><h4><div><span><blockquote>';
    $clean = strip_tags($clean, $allowed);

    // Attributes: drop them all, then put href back on anchors that had a safe one.
    $clean = preg_replace_callback('/<([a-z0-9]+)\b([^>]*)>/i', function ($match) {
        $tag = strtolower($match[1]);
        if ($tag !== 'a') {
            return '<' . $tag . '>';
        }
        if (preg_match('/\bhref\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))/i', $match[2], $href)) {
            $url = trim($href[2] ?? $href[3] ?? $href[4] ?? '');
            // http, https and mailto only: javascript: and data: are the reason this exists.
            if (preg_match('#^(https?://|mailto:)#i', $url)) {
                return '<a href="' . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '">';
            }
        }
        return '<a>';
    }, $clean);

    $clean = trim($clean);
    if ($clean === '') {
        throw new InvalidArgumentException('The email body cannot be empty.');
    }
    if (mb_strlen($clean) > 60000) {
        throw new InvalidArgumentException('The email body is too long.');
    }
    return $clean;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        echo json_encode([
            'success' => true,
            'config' => bonusEmailConfig($pdo),
            'variables' => BONUS_EMAIL_VARIABLES,
            'defaults' => [
                'subject' => BONUS_EMAIL_DEFAULT_SUBJECT,
                'body' => BONUS_EMAIL_DEFAULT_BODY
            ],
            // The screen says out loud whether a message can actually leave the building,
            // rather than letting the first failed approval be how anyone finds out.
            'transport_configured' => bonusEmailEnv('SMTP_HOST') !== '' || function_exists('mail')
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$data = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $data['action'] ?? '';

try {
    /* ── Preview ────────────────────────────────────────────────────────────
       Renders what is on screen -- not what is stored -- against a real month, so the
       user sees their unsaved edit resolved. Sends nothing; there is no transport
       call anywhere in this branch. */
    if ($action === 'preview') {
        $year = isset($data['year']) ? (int) $data['year'] : (int) date('Y');
        $month = isset($data['month']) ? (int) $data['month'] : (int) date('n');
        $type = trim((string) ($data['bonus_type'] ?? BONUS_TYPE_HOME_OFFICE));
        $type = $type === '' ? BONUS_TYPE_HOME_OFFICE : $type;

        $stored = bonusEmailConfig($pdo);
        $subject = array_key_exists('subject', $data) ? (string) $data['subject'] : $stored['subject'];
        $body = array_key_exists('body', $data) ? (string) $data['body'] : $stored['body'];

        ensureBonusTables($pdo);
        $rows = bonusMonthRows($pdo, $type, $year, $month);
        $totals = bonusPeriodTotals($rows);
        $state = bonusPeriodState($pdo, $type, $year, $month);

        // Real figures where the month has them. The approver and the date are only known
        // once it IS approved, so an unapproved month previews with the person looking at
        // the screen and today -- which is what they would be if it were approved now.
        $actor = $_SESSION['full_name'] ?? $_SESSION['username'] ?? 'Unknown user';
        $variables = bonusEmailVariables([
            'bonus_name' => BONUS_EMAIL_BONUS_NAME,
            'year' => $year,
            'month' => $month,
            'employees' => $totals['employees'],
            'total_dop' => $totals['DOP'],
            'total_usd' => $totals['USD'],
            'approved_by' => $state['approved_by'] ?? $actor,
            'approved_at' => $state['approved_at']
                ? date('d/m/Y H:i', strtotime($state['approved_at']))
                : date('d/m/Y H:i')
        ]);

        echo json_encode([
            'success' => true,
            'preview' => [
                'subject' => bonusEmailRender($subject, $variables, false),
                'body' => bonusEmailRender(bonusEmailSanitizeBody($body), $variables, true),
                'recipients' => $stored['recipients'],
                'is_live_data' => $rows !== []
            ]
        ]);
        exit;
    }

    /* ── Reset ──────────────────────────────────────────────────────────────
       Explicit, and the only thing that puts the default back. */
    if ($action === 'reset') {
        if (!current_is_admin()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Only an administrator can change this.']);
            exit;
        }

        $target = $data['target'] ?? 'all';
        if ($target === 'subject' || $target === 'all') {
            bonusEmailClearSetting($pdo, BONUS_EMAIL_SUBJECT_KEY);
        }
        if ($target === 'body' || $target === 'all') {
            bonusEmailClearSetting($pdo, BONUS_EMAIL_BODY_KEY);
        }

        echo json_encode(['success' => true, 'config' => bonusEmailConfig($pdo)]);
        exit;
    }

    /* ── Save ───────────────────────────────────────────────────────────── */
    if (!current_is_admin()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Only an administrator can change this.']);
        exit;
    }

    $touched = false;

    if (array_key_exists('recipients', $data)) {
        $recipients = bonusEmailNormalizeRecipients($data['recipients']);
        // An empty list is a valid configuration -- section 16 says an approval with no
        // recipients completes and warns -- so it is stored rather than treated as absent.
        bonusEmailStoreSetting($pdo, BONUS_EMAIL_RECIPIENTS_KEY, json_encode($recipients));
        $touched = true;
    }

    if (array_key_exists('subject', $data)) {
        $subject = trim((string) $data['subject']);
        if ($subject === '') {
            throw new InvalidArgumentException('The email subject cannot be empty.');
        }
        if (mb_strlen($subject) > 255) {
            throw new InvalidArgumentException('The email subject is too long.');
        }
        bonusEmailStoreSetting($pdo, BONUS_EMAIL_SUBJECT_KEY, $subject);
        $touched = true;
    }

    if (array_key_exists('body', $data)) {
        bonusEmailStoreSetting($pdo, BONUS_EMAIL_BODY_KEY, bonusEmailSanitizeBody((string) $data['body']));
        $touched = true;
    }

    if (!$touched) {
        throw new InvalidArgumentException('Nothing to update.');
    }

    echo json_encode(['success' => true, 'config' => bonusEmailConfig($pdo)]);
} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
