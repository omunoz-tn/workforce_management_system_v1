<?php
/**
 * BonusApproval.php
 * The approval state of one bonus month, and the review that runs before it is granted.
 *
 * A month is APPROVED as a whole or not at all. There is no per-employee approval and no
 * partial state: the thing being signed off is the list, because that is what Finance is
 * handed. `org_bonus_periods` therefore holds one row per (bonus_type, year, month), and a
 * month with no row has simply never been approved.
 *
 * Three states, and only two of them are stored:
 *
 *   open      no row, or a row that has been reopened -- the list is editable
 *   approved  signed off and LOCKED; every write against the month is refused
 *   reopened  approved once, then deliberately unlocked with a written reason
 *
 * "reopened" is kept distinct from "never approved" on purpose. They behave identically --
 * both are editable -- but they are not the same fact, and the banner says which one the
 * reader is looking at.
 *
 * The lock is enforced HERE rather than in the UI. A read-only cell is a courtesy; the
 * guard below is the guarantee, and it is what a second tab, a stale page or a direct API
 * call runs into.
 *
 * Nothing in this file computes a bonus. The review reads the figures the module already
 * produced and reports on them; it never writes a row, which is what lets it run on every
 * click of Approve without being something the user has to undo.
 */

const BONUS_PERIOD_APPROVED = 'approved';
const BONUS_PERIOD_REOPENED = 'reopened';
const BONUS_PERIOD_OPEN = 'open';

/** Creates the period table if missing, once per request. */
function ensureBonusPeriodTable(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `org_bonus_periods` (
          `id` int(11) NOT NULL AUTO_INCREMENT,
          `bonus_type` varchar(64) NOT NULL DEFAULT '" . BONUS_TYPE_HOME_OFFICE . "',
          `period_year` smallint(6) NOT NULL,
          `period_month` tinyint(4) NOT NULL,
          -- 'approved' or 'reopened'. A month with no row here has never been approved.
          `status` varchar(16) NOT NULL DEFAULT '" . BONUS_PERIOD_APPROVED . "',
          -- Denormalised like the audit log: who approved is a fact about that moment, and
          -- a join back to a user table would rewrite it the day somebody is renamed.
          `approved_by_id` int(11) DEFAULT NULL,
          `approved_by_name` varchar(255) DEFAULT NULL,
          `approved_at` datetime DEFAULT NULL,
          `reopened_by_id` int(11) DEFAULT NULL,
          `reopened_by_name` varchar(255) DEFAULT NULL,
          `reopened_at` datetime DEFAULT NULL,
          -- Required by the reopen flow; kept because \"why is August editable again\" is the
          -- question this row exists to answer.
          `reopen_reason` text DEFAULT NULL,
          -- What was approved, frozen at approval time. The live list can move afterwards
          -- (reopened, edited, re-approved) and the banner still says what was signed off.
          `approved_employees` int(11) DEFAULT NULL,
          `approved_total_dop` decimal(14,2) DEFAULT NULL,
          `approved_total_usd` decimal(14,2) DEFAULT NULL,
          `created_at` timestamp NULL DEFAULT current_timestamp(),
          `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
          PRIMARY KEY (`id`),
          UNIQUE KEY `unique_bonus_period` (`bonus_type`,`period_year`,`period_month`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    ");
}

/** The stored row for one month, or null when the month has never been approved. */
function bonusPeriodRow(PDO $pdo, string $bonusType, int $year, int $month): ?array
{
    ensureBonusPeriodTable($pdo);

    $stmt = $pdo->prepare(
        'SELECT * FROM org_bonus_periods
         WHERE bonus_type = :bonus_type AND period_year = :year AND period_month = :month'
    );
    $stmt->execute(['bonus_type' => $bonusType, 'year' => $year, 'month' => $month]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    return $row === false ? null : $row;
}

/**
 * The month's approval state, shaped for the client. Always returns something: a month with
 * no row is reported as open rather than as missing, so the UI has one thing to read.
 */
function bonusPeriodState(PDO $pdo, string $bonusType, int $year, int $month): array
{
    $row = bonusPeriodRow($pdo, $bonusType, $year, $month);

    if ($row === null) {
        return [
            'status' => BONUS_PERIOD_OPEN,
            'locked' => false,
            'approved_by' => null,
            'approved_at' => null,
            'reopened_by' => null,
            'reopened_at' => null,
            'reopen_reason' => null,
            'approved_employees' => null,
            'approved_total_dop' => null,
            'approved_total_usd' => null
        ];
    }

    $status = $row['status'] === BONUS_PERIOD_APPROVED ? BONUS_PERIOD_APPROVED : BONUS_PERIOD_REOPENED;

    return [
        'status' => $status,
        'locked' => $status === BONUS_PERIOD_APPROVED,
        'approved_by' => $row['approved_by_name'],
        'approved_at' => $row['approved_at'],
        'reopened_by' => $row['reopened_by_name'],
        'reopened_at' => $row['reopened_at'],
        'reopen_reason' => $row['reopen_reason'],
        'approved_employees' => $row['approved_employees'] === null ? null : (int) $row['approved_employees'],
        'approved_total_dop' => $row['approved_total_dop'] === null ? null : (float) $row['approved_total_dop'],
        'approved_total_usd' => $row['approved_total_usd'] === null ? null : (float) $row['approved_total_usd']
    ];
}

function bonusPeriodIsLocked(PDO $pdo, string $bonusType, int $year, int $month): bool
{
    $row = bonusPeriodRow($pdo, $bonusType, $year, $month);
    return $row !== null && $row['status'] === BONUS_PERIOD_APPROVED;
}

/**
 * The guard every write in manage_bonus.php passes through.
 *
 * Throws rather than returning false: a locked month has to fail the request loudly, and
 * the message is what the user sees, so it says where the way out is.
 *
 * InvalidArgumentException specifically, because that is what every handler in
 * manage_bonus.php already answers with a 400 and the exception's own message. A
 * RuntimeException would fall through to the generic catch and reach the user as an
 * anonymous 500, which reads as "the server broke" rather than "the month is closed".
 */
function bonusAssertPeriodEditable(PDO $pdo, string $bonusType, int $year, int $month): void
{
    if (bonusPeriodIsLocked($pdo, $bonusType, $year, $month)) {
        throw new InvalidArgumentException(
            'This bonus period is approved and locked. Reopen it from Configuration > HR '
            . '> Bonus Period Management to make changes.'
        );
    }
}

/**
 * Which month a given bonus row belongs to. The PUT and DELETE handlers address a row by
 * its id alone, so the lock has to be looked up from the row rather than from the request.
 */
function bonusRowPeriod(PDO $pdo, int $rowId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT bonus_type, period_year, period_month FROM org_bonus_employees WHERE id = :id'
    );
    $stmt->execute(['id' => $rowId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    return $row === false ? null : [
        'bonus_type' => $row['bonus_type'],
        'year' => (int) $row['period_year'],
        'month' => (int) $row['period_month']
    ];
}

/** Same guard, for a write addressed by row id. A row that no longer exists is not blocked. */
function bonusAssertRowEditable(PDO $pdo, int $rowId): void
{
    $period = bonusRowPeriod($pdo, $rowId);
    if ($period !== null) {
        bonusAssertPeriodEditable($pdo, $period['bonus_type'], $period['year'], $period['month']);
    }
}

/**
 * Per-currency totals for a month, plus the head count.
 *
 * Pesos and dollars are never added together -- no exchange rate exists anywhere in this
 * module, and inventing one at the last step would make the approved figure a fiction.
 */
function bonusPeriodTotals(array $rows): array
{
    $totals = ['employees' => count($rows), 'DOP' => 0.0, 'USD' => 0.0];

    foreach ($rows as $row) {
        $code = ($row['currency'] ?? '') === 'USD' ? 'USD' : 'DOP';
        $totals[$code] += (float) ($row['total_earned'] ?? 0);
    }

    $totals['DOP'] = round($totals['DOP'], 2);
    $totals['USD'] = round($totals['USD'], 2);

    return $totals;
}

/**
 * The pre-approval review: four questions asked of the whole list, and the employees whose
 * answers need a human to look at them.
 *
 * Read-only by construction -- it takes the rows the GET handler already assembled and
 * returns a verdict. Nothing here corrects anything, because a review that silently fixed
 * what it found would be an edit nobody asked for on the screen where edits are about to be
 * frozen.
 *
 * Warnings do NOT block the approval. They are what the user weighs before confirming; an
 * employee with no company, or with zero days worked, may be perfectly correct. The count
 * is of EMPLOYEES needing attention, not of issues, because one row with three problems is
 * still one person to go and look at.
 */
function bonusReviewList(array $rows): array
{
    $missingAmount = [];
    $missingWorkdays = [];
    $incompleteCalculation = [];
    $missingCurrency = [];
    $attention = [];

    foreach ($rows as $row) {
        $name = (string) ($row['employee_name'] ?? 'Unnamed row');
        $issues = [];

        if (!isset($row['bonus_amount']) || (float) $row['bonus_amount'] <= 0) {
            $missingAmount[] = $name;
            $issues[] = 'no bonus amount';
        }

        // Workdays is the month's own figure for that employee's team. Zero means the
        // calendar produced nothing to earn against, so the earned amount cannot be right.
        if (!isset($row['workdays']) || (int) $row['workdays'] <= 0) {
            $missingWorkdays[] = $name;
            $issues[] = 'no workday information';
        }

        if (!in_array($row['currency'] ?? null, ['DOP', 'USD'], true)) {
            $missingCurrency[] = $name;
            $issues[] = 'no currency';
        }

        // "Calculation completed" means the two derived figures are present and numeric.
        // Nothing more: days ABOVE the month's workdays is normal, not broken -- somebody
        // who worked a Saturday tracked more days than the month scheduled, and
        // bonusEarnedAmount() already caps the payout at the full bonus. Flagging that would
        // put half a dozen names in front of the approver every month for no decision, which
        // is how a warning list stops being read at all.
        $days = $row['days_worked'] ?? null;
        $earned = $row['total_earned'] ?? null;

        if ($days === null || !is_numeric($days) || $earned === null || !is_numeric($earned)) {
            $incompleteCalculation[] = $name;
            $issues[] = 'calculation incomplete';
        } elseif ((int) $days === 0) {
            // Not a failed check -- the figure is correct -- but this person earns nothing,
            // which is exactly the thing worth seeing before the month is frozen.
            $issues[] = 'zero days worked, earns nothing';
        }

        if ($issues !== []) {
            $attention[] = ['employee_name' => $name, 'issues' => $issues];
        }
    }

    $checks = [
        [
            'id' => 'bonus_amount',
            'label' => 'All employees have a bonus amount',
            'passed' => $missingAmount === [],
            'failed' => count($missingAmount)
        ],
        [
            'id' => 'workdays',
            'label' => 'All employees have workday information',
            'passed' => $missingWorkdays === [],
            'failed' => count($missingWorkdays)
        ],
        [
            'id' => 'calculations',
            'label' => 'All calculations completed',
            'passed' => $incompleteCalculation === [],
            'failed' => count($incompleteCalculation)
        ],
        [
            'id' => 'currency',
            'label' => 'Currency assigned',
            'passed' => $missingCurrency === [],
            'failed' => count($missingCurrency)
        ]
    ];

    return [
        'checks' => $checks,
        // Capped: the modal lists them, and a month where every row needs attention is
        // answered by the count, not by scrolling three hundred names.
        'attention' => array_slice($attention, 0, 50),
        'attention_count' => count($attention),
        'employees' => count($rows)
    ];
}
