<?php
/**
 * BonusEmail.php
 * The Finance notification sent when a bonus month is approved: who receives it, what it
 * says, and how it leaves the building.
 *
 * The text is DATA, not code. Subject and body live in platform_settings and the defaults
 * below are only what a server that has never been configured starts from -- once HR saves
 * a version, that is the one that is sent, forever, and nothing here overwrites it. That is
 * the whole reason the default is a constant in this file rather than a string inside the
 * sending function: the sender renders whatever is stored, and has no opinion about it.
 *
 * Variables are square-bracketed names ([Month], [Total USD], ...) replaced at send time.
 * Bracket syntax rather than {{mustache}} because HR types these into a rich-text box by
 * hand as often as they pick them from the menu, and brackets survive a copy-paste through
 * Word without being turned into something else.
 *
 * Delivery is deliberately best-effort and SEPARATE from the approval. See bonusEmailSend():
 * it reports what happened and never throws, because an approval that succeeded must not be
 * undone by a mail server that is down.
 */

const BONUS_EMAIL_RECIPIENTS_KEY = 'bonus_email_recipients';
const BONUS_EMAIL_SUBJECT_KEY = 'bonus_email_subject';
const BONUS_EMAIL_BODY_KEY = 'bonus_email_body';

/** Only what the default template needs plus what a month can say about itself. */
const BONUS_EMAIL_VARIABLES = [
    'Bonus Name', 'Month', 'Year', 'Period', 'Total Employees',
    'Total USD', 'Total DOP', 'Approved By', 'Approval Date'
];

const BONUS_EMAIL_DEFAULT_SUBJECT = 'Bonos listos para procesamiento de pago – [Month] [Year]';

/**
 * The starting template, in the language Finance reads it in. Stored as HTML because the
 * body is edited in a rich-text box; the markup is the plain subset that survives every
 * mail client (<p>, <strong>, <em>, <ul>, <br>).
 */
const BONUS_EMAIL_DEFAULT_BODY = '<p>Hola,</p>'
    . '<p>Los bonos correspondientes a [Month] [Year] han sido revisados y aprobados por el '
    . 'departamento de HR y se encuentran listos para el procesamiento de los pagos.</p>'
    . '<p><strong>Información de los bonos:</strong></p>'
    . '<ul>'
    . '<li>Bono: [Bonus Name]</li>'
    . '<li>Período: [Period]</li>'
    . '<li>Cantidad de empleados: [Total Employees]</li>'
    . '<li>Total USD: [Total USD]</li>'
    . '<li>Total DOP: [Total DOP]</li>'
    . '<li>Aprobado por: [Approved By]</li>'
    . '<li>Fecha de aprobación: [Approval Date]</li>'
    . '</ul>'
    . '<p>Por favor, proceder con el procesamiento de los pagos correspondientes.</p>'
    . '<p>Gracias,<br>Departamento de HR</p>';

/**
 * One setting, or null when nothing has been stored.
 *
 * Absent and empty are different answers here: an empty recipient list is a decision HR can
 * make, while an absent subject means "never configured, use the default". Hence null rather
 * than a falsy string.
 */
function bonusEmailSetting(PDO $pdo, string $key): ?string
{
    // Same guard the worked-day-hours setting uses: this table is read on every load of the
    // configuration screen and a server that never ran the migration must degrade to the
    // defaults rather than lose the page.
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `platform_settings` (
          `setting_key` varchar(64) NOT NULL,
          `setting_value` text DEFAULT NULL,
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`setting_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");

    $stmt = $pdo->prepare('SELECT setting_value FROM platform_settings WHERE setting_key = :key');
    $stmt->execute(['key' => $key]);
    $value = $stmt->fetchColumn();

    return $value === false ? null : (string) $value;
}

function bonusEmailStoreSetting(PDO $pdo, string $key, string $value): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO platform_settings (setting_key, setting_value)
         VALUES (:key, :value)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
    );
    $stmt->execute(['key' => $key, 'value' => $value]);
}

/** Forgets a setting, which is how "reset to default" works without a second column. */
function bonusEmailClearSetting(PDO $pdo, string $key): void
{
    $stmt = $pdo->prepare('DELETE FROM platform_settings WHERE setting_key = :key');
    $stmt->execute(['key' => $key]);
}

/** The whole configuration in force: what is stored, falling back to the defaults. */
function bonusEmailConfig(PDO $pdo): array
{
    $recipientsRaw = bonusEmailSetting($pdo, BONUS_EMAIL_RECIPIENTS_KEY);
    $recipients = [];
    if ($recipientsRaw !== null) {
        $decoded = json_decode($recipientsRaw, true);
        if (is_array($decoded)) {
            $recipients = array_values(array_filter($decoded, 'is_string'));
        }
    }

    $subject = bonusEmailSetting($pdo, BONUS_EMAIL_SUBJECT_KEY);
    $body = bonusEmailSetting($pdo, BONUS_EMAIL_BODY_KEY);

    return [
        'recipients' => $recipients,
        'subject' => $subject ?? BONUS_EMAIL_DEFAULT_SUBJECT,
        'body' => $body ?? BONUS_EMAIL_DEFAULT_BODY,
        // What the screen needs to know to offer "reset to default" honestly.
        'is_custom_subject' => $subject !== null,
        'is_custom_body' => $body !== null
    ];
}

/** Normalises and checks one address. Throws with the address in the message. */
function bonusEmailNormalizeAddress($value): string
{
    $address = trim((string) $value);
    if ($address === '') {
        throw new InvalidArgumentException('Enter an email address.');
    }
    if (!filter_var($address, FILTER_VALIDATE_EMAIL)) {
        throw new InvalidArgumentException("\"$address\" is not a valid email address.");
    }
    if (mb_strlen($address) > 254) {
        throw new InvalidArgumentException('That email address is too long.');
    }
    return $address;
}

/**
 * The stored recipient list from a submitted one: validated, trimmed, and de-duplicated
 * case-insensitively, since Finance@ and finance@ are one mailbox.
 */
function bonusEmailNormalizeRecipients($value): array
{
    if (!is_array($value)) {
        throw new InvalidArgumentException('Recipients must be a list of email addresses.');
    }
    if (count($value) > 50) {
        throw new InvalidArgumentException('A notification is capped at 50 recipients.');
    }

    $clean = [];
    $seen = [];
    foreach ($value as $entry) {
        $address = bonusEmailNormalizeAddress($entry);
        $key = mb_strtolower($address);
        if (isset($seen[$key])) {
            throw new InvalidArgumentException("\"$address\" is already on the list.");
        }
        $seen[$key] = true;
        $clean[] = $address;
    }

    return $clean;
}

/**
 * The values every [Variable] resolves to for one approved month.
 *
 * Money is formatted the way the module writes it everywhere else -- "RD$ 450,000.00" --
 * because this string goes into a human's inbox, not into a spreadsheet.
 */
function bonusEmailVariables(array $context): array
{
    $months = [
        1 => 'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    $year = (int) ($context['year'] ?? 0);
    $month = (int) ($context['month'] ?? 0);
    $monthName = $months[$month] ?? '';
    $period = trim("$monthName $year");

    return [
        'Bonus Name' => (string) ($context['bonus_name'] ?? 'Bonus Home Office / Transportation'),
        'Month' => $monthName,
        'Year' => $year > 0 ? (string) $year : '',
        'Period' => $period,
        'Total Employees' => (string) (int) ($context['employees'] ?? 0),
        'Total USD' => 'US$ ' . number_format((float) ($context['total_usd'] ?? 0), 2),
        'Total DOP' => 'RD$ ' . number_format((float) ($context['total_dop'] ?? 0), 2),
        'Approved By' => (string) ($context['approved_by'] ?? ''),
        'Approval Date' => (string) ($context['approved_at'] ?? '')
    ];
}

/**
 * Substitutes the variables into a template.
 *
 * `$escape` is on for the HTML body and off for the subject: a name like "Muñoz & Co"
 * has to arrive intact in both, which means entity-escaping it in the one that is markup and
 * leaving it alone in the one that is not. An unknown [Bracket] is left exactly as typed --
 * HR writing "[pendiente]" in a sentence is not a variable, and silently deleting it would
 * be the worst possible reading of the intent.
 */
function bonusEmailRender(string $template, array $variables, bool $escape): string
{
    $rendered = $template;
    foreach ($variables as $name => $value) {
        $replacement = $escape ? htmlspecialchars($value, ENT_QUOTES, 'UTF-8') : $value;
        $rendered = str_replace("[$name]", $replacement, $rendered);
    }
    return $rendered;
}

/** A plain-text fallback part, so a client that refuses HTML still shows something. */
function bonusEmailPlainText(string $html): string
{
    $text = preg_replace('/<\s*(br|\/p|\/li|\/h[1-6])\s*\/?>/i', "\n", $html);
    $text = preg_replace('/<\s*li[^>]*>/i', '- ', $text);
    $text = strip_tags($text);
    $text = html_entity_decode($text, ENT_QUOTES, 'UTF-8');
    $text = preg_replace("/\n{3,}/", "\n\n", $text);
    return trim($text);
}

/** One value out of the environment, from the .env db_wfm_config.php already parsed. */
function bonusEmailEnv(string $key, string $default = ''): string
{
    $fromEnvFile = $GLOBALS['env'][$key] ?? null;
    if (is_string($fromEnvFile) && $fromEnvFile !== '') {
        return $fromEnvFile;
    }
    $fromProcess = getenv($key);
    return ($fromProcess !== false && $fromProcess !== '') ? $fromProcess : $default;
}

/**
 * Sends the notification. NEVER throws.
 *
 * Returns ['sent' => bool, 'count' => int, 'error' => ?string]. The caller has already
 * approved the month by the time this runs, and section 17 of the brief is explicit: a
 * failed email must not undo a successful approval. So every failure path here ends in a
 * report, not an exception.
 *
 * Two transports, in order. SMTP when SMTP_HOST is configured -- the container image has no
 * MTA, so that is the one that works in production. PHP's mail() otherwise, which covers a
 * server that does have one. Neither configured is itself a reportable failure rather than a
 * silent success.
 */
function bonusEmailSend(array $recipients, string $subject, string $html): array
{
    if ($recipients === []) {
        return ['sent' => false, 'count' => 0, 'error' => 'No recipients are configured.'];
    }

    $from = bonusEmailEnv('SMTP_FROM', bonusEmailEnv('SMTP_USER'));
    $fromName = bonusEmailEnv('SMTP_FROM_NAME', 'HR Bonus');
    $host = bonusEmailEnv('SMTP_HOST');

    try {
        if ($host !== '') {
            bonusEmailSendSmtp($recipients, $subject, $html, $from, $fromName);
            return ['sent' => true, 'count' => count($recipients), 'error' => null];
        }

        if (!function_exists('mail')) {
            return [
                'sent' => false,
                'count' => 0,
                'error' => 'No mail transport is configured. Set SMTP_HOST in .env.'
            ];
        }

        $headers = bonusEmailHeaders($from, $fromName);
        $ok = @mail(implode(', ', $recipients), bonusEmailEncodeHeader($subject), $html, implode("\r\n", $headers));
        if (!$ok) {
            return ['sent' => false, 'count' => 0, 'error' => 'The mail server rejected the message.'];
        }
        return ['sent' => true, 'count' => count($recipients), 'error' => null];
    } catch (Exception $e) {
        error_log('Bonus approval email failed: ' . $e->getMessage());
        return ['sent' => false, 'count' => 0, 'error' => $e->getMessage()];
    }
}

/** RFC 2047 for a subject or display name that is not plain ASCII. */
function bonusEmailEncodeHeader(string $value): string
{
    return preg_match('/[\x80-\xFF]/', $value)
        ? '=?UTF-8?B?' . base64_encode($value) . '?='
        : $value;
}

function bonusEmailHeaders(string $from, string $fromName): array
{
    $headers = ['MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8'];
    if ($from !== '') {
        $headers[] = 'From: ' . bonusEmailEncodeHeader($fromName) . ' <' . $from . '>';
    }
    return $headers;
}

/**
 * A minimal SMTP client over fsockopen.
 *
 * Written out rather than pulled in: the project has no composer and the image has no mail
 * extension, so a dependency would mean changing how the container is built -- which is
 * deferred for unrelated reasons. This speaks enough of the protocol for a notification:
 * EHLO, optional STARTTLS, optional AUTH LOGIN, one message to N recipients.
 *
 * Throws on any step the server does not accept; bonusEmailSend() turns that into a report.
 */
function bonusEmailSendSmtp(array $recipients, string $subject, string $html, string $from, string $fromName): void
{
    $host = bonusEmailEnv('SMTP_HOST');
    $port = (int) bonusEmailEnv('SMTP_PORT', '587');
    $user = bonusEmailEnv('SMTP_USER');
    $pass = bonusEmailEnv('SMTP_PASS');
    // 'ssl' dials TLS immediately (port 465); 'tls' upgrades an open connection (587).
    $secure = strtolower(bonusEmailEnv('SMTP_SECURE', $port === 465 ? 'ssl' : 'tls'));
    $sender = $from !== '' ? $from : $user;

    if ($sender === '') {
        throw new RuntimeException('SMTP_FROM or SMTP_USER must be set to send mail.');
    }

    $target = ($secure === 'ssl' ? 'ssl://' : '') . $host . ':' . $port;
    $socket = @stream_socket_client($target, $errno, $errstr, 10);
    if ($socket === false) {
        throw new RuntimeException("Could not reach the mail server ($errstr).");
    }
    stream_set_timeout($socket, 15);

    $read = function () use ($socket): string {
        $response = '';
        while (($line = fgets($socket, 515)) !== false) {
            $response .= $line;
            // A multi-line reply repeats the code with '-'; a space means the last line.
            if (strlen($line) < 4 || $line[3] === ' ') {
                break;
            }
        }
        return $response;
    };
    $expect = function (string $response, string $codes, string $step) {
        $code = substr(trim($response), 0, 3);
        if (strpos($codes, $code) === false) {
            throw new RuntimeException("SMTP $step failed: " . trim($response));
        }
    };
    $send = function (string $command) use ($socket) {
        fwrite($socket, $command . "\r\n");
    };

    try {
        $expect($read(), '220', 'greeting');

        $hello = bonusEmailEnv('SMTP_HELO', 'localhost');
        $send("EHLO $hello");
        $expect($read(), '250', 'EHLO');

        if ($secure === 'tls') {
            $send('STARTTLS');
            $expect($read(), '220', 'STARTTLS');
            if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('Could not start TLS with the mail server.');
            }
            // The session resets after the upgrade, so the greeting has to be repeated.
            $send("EHLO $hello");
            $expect($read(), '250', 'EHLO after STARTTLS');
        }

        if ($user !== '') {
            $send('AUTH LOGIN');
            $expect($read(), '334', 'AUTH');
            $send(base64_encode($user));
            $expect($read(), '334', 'username');
            $send(base64_encode($pass));
            $expect($read(), '235', 'password');
        }

        $send("MAIL FROM:<$sender>");
        $expect($read(), '250', 'MAIL FROM');

        foreach ($recipients as $recipient) {
            $send("RCPT TO:<$recipient>");
            // 251 is "will forward", which is a yes.
            $expect($read(), '250 251', "RCPT TO $recipient");
        }

        $send('DATA');
        $expect($read(), '354', 'DATA');

        $headers = [
            'From: ' . bonusEmailEncodeHeader($fromName) . ' <' . $sender . '>',
            'To: ' . implode(', ', $recipients),
            'Subject: ' . bonusEmailEncodeHeader($subject),
            'Date: ' . date('r'),
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: base64'
        ];

        // Base64 side-steps SMTP's line-length limit and dot-stuffing entirely, which is
        // what a body full of accented Spanish and long <li> lines would otherwise trip on.
        $body = chunk_split(base64_encode($html), 76, "\r\n");
        $send(implode("\r\n", $headers) . "\r\n\r\n" . $body . "\r\n.");
        $expect($read(), '250', 'message body');

        $send('QUIT');
    } finally {
        fclose($socket);
    }
}
