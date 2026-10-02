<?php
/**
 * manage_bonus_approval.php
 * Approving a bonus month, reviewing it first, and reopening it afterwards.
 *
 * GET  ?bonus_type=&year=&month=
 *      -> the month's approval state, its review, and its totals
 * POST { action: 'review',  bonus_type, year, month }
 *      -> the same review on demand, run when Approve is pressed. Writes NOTHING.
 * POST { action: 'approve', bonus_type, year, month }
 *      -> locks the month, then notifies Finance
 * POST { action: 'reopen',  bonus_type, year, month, reason }
 *      -> unlocks it again, with the reason recorded
 *
 * The order in `approve` is the whole design: the period is committed FIRST and the email
 * is attempted afterwards, outside the transaction. Section 17 of the brief is explicit and
 * it is also just correct -- a mail server being down is not a reason to un-approve a
 * month's payroll. The response therefore reports two independent outcomes, and the caller
 * renders both.
 *
 * Approval is admin-only. It freezes what Finance pays and is the one action here that
 * cannot be walked back without a written reason.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'BonusSql.php';
require_once 'BonusAudit.php';
require_once 'BonusApproval.php';
require_once 'BonusEmail.php';

session_start();
ensureBonusTables($pdo);
ensureBonusPeriodTable($pdo);

const BONUS_APPROVAL_NAME = 'Bonus Home Office / Transportation';

/** Reads and validates the period off a request. */
function approvalPeriod(array $source): array
{
    $year = isset($source['year']) ? (int) $source['year'] : (int) date('Y');
    $month = isset($source['month']) ? (int) $source['month'] : (int) date('n');

    if ($year < 2000 || $year > 2100) {
        throw new InvalidArgumentException('year must be a four-digit calendar year.');
    }
    if ($month < 1 || $month > 12) {
        throw new InvalidArgumentException('month must be between 1 and 12.');
    }

    $type = trim((string) ($source['bonus_type'] ?? BONUS_TYPE_HOME_OFFICE));
    return [$year, $month, $type === '' ? BONUS_TYPE_HOME_OFFICE : $type];
}

/** "August 2026", the label every message in this flow uses. */
function approvalPeriodLabel(int $year, int $month): string
{
    $months = [
        1 => 'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return ($months[$month] ?? '') . ' ' . $year;
}

/**
 * The month as the approval sees it: every row, unscoped by team.
 *
 * Deliberately NOT team-filtered. Approving a month signs off the month; showing a
 * team-scoped approver a partial total and calling it the period's total would put a number
 * in Finance's inbox that describes nobody's reality.
 */
function approvalRows(PDO $pdo, string $type, int $year, int $month): array
{
    return bonusMonthRows($pdo, $type, $year, $month);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        [$year, $month, $type] = approvalPeriod($_GET);
        $rows = approvalRows($pdo, $type, $year, $month);

        echo json_encode([
            'success' => true,
            'period' => ['year' => $year, 'month' => $month, 'label' => approvalPeriodLabel($year, $month)],
            'approval' => bonusPeriodState($pdo, $type, $year, $month),
            'review' => bonusReviewList($rows),
            'totals' => bonusPeriodTotals($rows)
        ]);
    } catch (InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
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
    [$year, $month, $type] = approvalPeriod($data);
    $label = approvalPeriodLabel($year, $month);

    /* ── Review ─────────────────────────────────────────────────────────────
       What runs when Approve is pressed, before anything is committed. Reads the
       month and reports on it; there is no write anywhere in this branch, which is
       what makes it safe to run on every click. */
    if ($action === 'review') {
        $rows = approvalRows($pdo, $type, $year, $month);

        echo json_encode([
            'success' => true,
            'period' => ['year' => $year, 'month' => $month, 'label' => $label],
            'approval' => bonusPeriodState($pdo, $type, $year, $month),
            'review' => bonusReviewList($rows),
            'totals' => bonusPeriodTotals($rows)
        ]);
        exit;
    }

    /* ── Approve ────────────────────────────────────────────────────────── */
    if ($action === 'approve') {
        if (!current_is_admin()) {
            http_response_code(403);
            echo json_encode([
                'success' => false,
                'error' => 'Only an administrator can approve a bonus period.'
            ]);
            exit;
        }

        if (bonusPeriodIsLocked($pdo, $type, $year, $month)) {
            throw new InvalidArgumentException("$label is already approved.");
        }

        $rows = approvalRows($pdo, $type, $year, $month);
        if ($rows === []) {
            throw new InvalidArgumentException(
                "There is nobody on the $label bonus list to approve."
            );
        }

        $totals = bonusPeriodTotals($rows);
        $actor = bonusAuditActor();
        $approvedAt = date('Y-m-d H:i:s');

        // Step 1: the approval itself. Committed before a single byte of email is attempted.
        $stmt = $pdo->prepare(
            'INSERT INTO org_bonus_periods
                (bonus_type, period_year, period_month, status, approved_by_id, approved_by_name,
                 approved_at, approved_employees, approved_total_dop, approved_total_usd,
                 reopened_by_id, reopened_by_name, reopened_at, reopen_reason)
             VALUES
                (:bonus_type, :year, :month, :status, :by_id, :by_name,
                 :approved_at, :employees, :total_dop, :total_usd,
                 NULL, NULL, NULL, NULL)
             ON DUPLICATE KEY UPDATE
                status = VALUES(status),
                approved_by_id = VALUES(approved_by_id),
                approved_by_name = VALUES(approved_by_name),
                approved_at = VALUES(approved_at),
                approved_employees = VALUES(approved_employees),
                approved_total_dop = VALUES(approved_total_dop),
                approved_total_usd = VALUES(approved_total_usd),
                -- A re-approval clears the previous reopening: the month is closed again,
                -- and the reason a now-superseded reopening was granted is history the
                -- audit log keeps, not current state.
                reopened_by_id = NULL,
                reopened_by_name = NULL,
                reopened_at = NULL,
                reopen_reason = NULL'
        );
        $stmt->execute([
            'bonus_type' => $type,
            'year' => $year,
            'month' => $month,
            'status' => BONUS_PERIOD_APPROVED,
            'by_id' => $actor['id'],
            'by_name' => $actor['name'],
            'approved_at' => $approvedAt,
            'employees' => $totals['employees'],
            'total_dop' => $totals['DOP'],
            'total_usd' => $totals['USD']
        ]);

        bonusAuditLog($pdo, [
            'bonus_type' => $type,
            'period_year' => $year,
            'period_month' => $month,
            'action' => 'approve',
            'field' => 'Period status',
            'old_value' => 'Open',
            'new_value' => sprintf(
                'Approved · %d employees · RD$ %s · US$ %s',
                $totals['employees'],
                number_format($totals['DOP'], 2),
                number_format($totals['USD'], 2)
            )
        ]);

        // Step 2: the notification. Everything below is best-effort, and every failure path
        // reports rather than throws -- the month is already approved and stays that way.
        $config = bonusEmailConfig($pdo);
        $variables = bonusEmailVariables([
            'bonus_name' => BONUS_APPROVAL_NAME,
            'year' => $year,
            'month' => $month,
            'employees' => $totals['employees'],
            'total_dop' => $totals['DOP'],
            'total_usd' => $totals['USD'],
            'approved_by' => $actor['name'],
            'approved_at' => date('d/m/Y H:i', strtotime($approvedAt))
        ]);

        $email = ['attempted' => false, 'sent' => false, 'count' => 0, 'error' => null];
        if ($config['recipients'] === []) {
            $email['error'] = 'No email recipients are configured for the Finance notification.';
        } else {
            $email['attempted'] = true;
            $result = bonusEmailSend(
                $config['recipients'],
                bonusEmailRender($config['subject'], $variables, false),
                bonusEmailRender($config['body'], $variables, true)
            );
            $email['sent'] = $result['sent'];
            $email['count'] = $result['count'];
            $email['error'] = $result['error'];
        }

        echo json_encode([
            'success' => true,
            'period' => ['year' => $year, 'month' => $month, 'label' => $label],
            'approval' => bonusPeriodState($pdo, $type, $year, $month),
            'totals' => $totals,
            'email' => $email
        ]);
        exit;
    }

    /* ── Reopen ─────────────────────────────────────────────────────────── */
    if ($action === 'reopen') {
        if (!current_is_admin()) {
            http_response_code(403);
            echo json_encode([
                'success' => false,
                'error' => 'Only an administrator can reopen a bonus period.'
            ]);
            exit;
        }

        // Checked here as well as in the modal. Whitespace is not a reason, and this is the
        // field the whole flow exists to capture.
        $reason = trim((string) ($data['reason'] ?? ''));
        if ($reason === '') {
            throw new InvalidArgumentException('A reason is required to reopen a bonus period.');
        }
        if (mb_strlen($reason) > 1000) {
            $reason = mb_substr($reason, 0, 1000);
        }

        $existing = bonusPeriodRow($pdo, $type, $year, $month);
        if ($existing === null || $existing['status'] !== BONUS_PERIOD_APPROVED) {
            throw new InvalidArgumentException("$label is not an approved period.");
        }

        $actor = bonusAuditActor();
        $stmt = $pdo->prepare(
            'UPDATE org_bonus_periods
                SET status = :status,
                    reopened_by_id = :by_id,
                    reopened_by_name = :by_name,
                    reopened_at = :reopened_at,
                    reopen_reason = :reason
              WHERE bonus_type = :bonus_type AND period_year = :year AND period_month = :month'
        );
        $stmt->execute([
            'status' => BONUS_PERIOD_REOPENED,
            'by_id' => $actor['id'],
            'by_name' => $actor['name'],
            'reopened_at' => date('Y-m-d H:i:s'),
            'reason' => $reason,
            'bonus_type' => $type,
            'year' => $year,
            'month' => $month
        ]);

        bonusAuditLog($pdo, [
            'bonus_type' => $type,
            'period_year' => $year,
            'period_month' => $month,
            'action' => 'reopen',
            'field' => 'Period status',
            'old_value' => 'Approved',
            'new_value' => 'Re-opened · ' . $reason
        ]);

        echo json_encode([
            'success' => true,
            'period' => ['year' => $year, 'month' => $month, 'label' => $label],
            'approval' => bonusPeriodState($pdo, $type, $year, $month)
        ]);
        exit;
    }

    throw new InvalidArgumentException('Unknown action.');
} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
