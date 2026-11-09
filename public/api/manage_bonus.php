<?php
/**
 * manage_bonus.php
 * The employee list behind HR > Bonus > Bonus Home Office / Transportation.
 *
 * A row is one employee's bonus FOR ONE MONTH — the month/year the screen was showing when
 * they were added. Nothing rolls over: September's list and October's list are separate
 * sets of rows, which is what lets an amount change month to month without rewriting
 * history.
 *
 * GET    ?bonus_type=&year=&month=
 *        -> the month's rows, each with Days Employee Worked and Workdays already computed
 *           (BonusSql.php) and the earned amount derived from them.
 * POST   { bonus_type, year, month, employee_id|null, employee_name, team_id|null,
 *          team_name, company_id|null, bonus_amount, currency }
 *                                                     -> enrol one employee
 * POST   { action: 'copy_previous', bonus_type, year, month }
 *                                                     -> seed the month from the one before
 * POST   { action: 'import', bonus_type, year, month, rows: [...] }
 *                                                     -> bulk-enrol from an uploaded list
 * PUT    { id, ...any of employee_id, employee_name, team_id, team_name, company_id,
 *          days_worked, bonus_amount, currency, comments }
 *                                                     -> edit one row
 * DELETE ?id=N                                        -> remove one row
 *
 * Every write here leaves an entry in org_bonus_audit_log (BonusAudit.php), which is what
 * HR > History reads. Logging never fails a save: see the note at the top of that file.
 *
 * days_worked on PUT is stored as an OVERRIDE: send null (or an empty string) to clear it
 * and go back to the computed figure. It is rejected above the month's Workdays, which is
 * itself not settable — it is a property of the calendar, not of the row.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'session_access.php';
require_once 'BonusSql.php';
require_once 'BonusAudit.php';
require_once 'BonusApproval.php';
// org_employees is the roster's canonical spelling of each name -- what the Employee
// Name column's override marker and reset compare against and restore to.
require_once 'EmployeeRoster.php';

session_start();
// The bonus list is not split by team: anyone who can open HR > Bonus sees and edits the
// whole month (a team-scoped view used to hide rows, including those with no team linked).
require_menu_access(['bonus']);
ensureBonusTables($pdo);
ensureOrgEmployeesTable($pdo);

$method = $_SERVER['REQUEST_METHOD'];

/** Reads the period off a request, defaulting to the current month. */
function bonusRequestPeriod(array $source): array
{
    $year = isset($source['year']) ? (int) $source['year'] : (int) date('Y');
    $month = isset($source['month']) ? (int) $source['month'] : (int) date('n');

    if ($year < 2000 || $year > 2100) {
        throw new InvalidArgumentException('year must be a four-digit calendar year.');
    }
    if ($month < 1 || $month > 12) {
        throw new InvalidArgumentException('month must be between 1 and 12.');
    }
    return [$year, $month];
}

function bonusRequestType(array $source): string
{
    $type = trim((string) ($source['bonus_type'] ?? BONUS_TYPE_HOME_OFFICE));
    return $type === '' ? BONUS_TYPE_HOME_OFFICE : $type;
}

/** '' and null both mean "no override"; anything else has to be a non-negative whole number. */
function bonusOptionalCount($value, string $field): ?int
{
    if ($value === null || $value === '') {
        return null;
    }
    if (!is_numeric($value) || (int) $value < 0) {
        throw new InvalidArgumentException("$field must be a whole number of days, or empty.");
    }
    return (int) $value;
}

function bonusRequestCurrency($value): string
{
    $currency = strtoupper(trim((string) $value));
    if (!in_array($currency, BONUS_CURRENCIES, true)) {
        throw new InvalidArgumentException('currency must be one of: ' . implode(', ', BONUS_CURRENCIES) . '.');
    }
    return $currency;
}

/** Names the row already holding this person, so the user can go and find it. */
function bonusDuplicateMessage(array $duplicate, int $year, int $month): string
{
    $period = date('F Y', strtotime(sprintf('%04d-%02d-01', $year, $month)));
    $team = $duplicate['team_name'] ? " (" . $duplicate['team_name'] . ")" : '';
    return $duplicate['employee_name'] . $team . " is already on the $period bonus list."
        . ' Each employee can only appear once, even across teams.';
}

function bonusRequestAmount($value): float
{
    if (!is_numeric($value) || (float) $value < 0) {
        throw new InvalidArgumentException('bonus_amount must be a positive number.');
    }
    return round((float) $value, 2);
}

if ($method === 'GET') {
    try {
        [$year, $month] = bonusRequestPeriod($_GET);
        $bonusType = bonusRequestType($_GET);
        [$from, $to] = bonusPeriodRange($year, $month);

        // The rows and every figure derived from them: see bonusMonthRows() in BonusSql.php,
        // which the approval endpoint reads too so the two cannot disagree about the month.
        $data = bonusMonthRows($pdo, $bonusType, $year, $month);
        $workdays = bonusWorkdays($pdo, $from, $to);

        echo json_encode([
            'success' => true,
            'period' => ['year' => $year, 'month' => $month, 'from' => $from, 'to' => $to],
            'workdays' => $workdays['default'],
            // Approved months come back locked, and the List turns its own cells read-only
            // from this. The server refuses the writes regardless -- see BonusApproval.php.
            'approval' => bonusPeriodState($pdo, $bonusType, $year, $month),
            'data' => $data
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

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];

    /**
     * "Load Last Month list": seeds this month from the previous one.
     *
     * Only what a person decided carries over -- who is on the list, which team and company
     * they are filed under, and how much their bonus is. Everything the platform works out for
     * itself is deliberately left behind, because it belongs to the month it was computed
     * in: Days Employee Worked and Workdays are recomputed against the new month on the
     * very next read, any manual correction to the days is dropped (it was about those
     * days), and comments are dropped (they were about that month).
     *
     * Additive, never destructive. Anyone already on the target month is skipped rather
     * than overwritten, using the same one-person-one-row rule an insert goes through, so
     * running it twice -- or running it after adding a few people by hand -- costs nothing.
     */
    /**
     * "Import List": bulk enrolment from a spreadsheet the client has already mapped
     * (utils/bonusImport.js resolves names against the roster and companies against the
     * catalog, and shows the person a preview before anything is sent).
     *
     * The server still re-validates every row: the one-person-one-month rule, the amount,
     * the currency, the company id. The client's mapping is a courtesy; this is the
     * guarantee, exactly as with the Add Employee modal. Additive like copy_previous —
     * rows already on the month are skipped, never overwritten — and each inserted row
     * leaves its own audit entry, because "when did she join this list" is asked per
     * person, not per upload.
     */
    if (($data['action'] ?? '') === 'import') {
        try {
            [$year, $month] = bonusRequestPeriod($data);
            $bonusType = bonusRequestType($data);

            // Every write into a month goes through this: an approved period is frozen, and
            // the read-only cells on screen are the courtesy, not the guarantee.
            bonusAssertPeriodEditable($pdo, $bonusType, $year, $month);

            $rows = $data['rows'] ?? [];
            if (!is_array($rows) || count($rows) === 0) {
                throw new InvalidArgumentException('The file has no importable rows.');
            }
            if (count($rows) > 500) {
                throw new InvalidArgumentException('An import is capped at 500 rows at a time.');
            }

            $insert = $pdo->prepare(
                "INSERT INTO org_bonus_employees
                    (bonus_type, period_year, period_month, employee_id, employee_name,
                     team_id, team_name, company_id, bonus_amount, currency, comments)
                 VALUES
                    (:bonus_type, :year, :month, :employee_id, :employee_name,
                     :team_id, :team_name, :company_id, :bonus_amount, :currency, :comments)"
            );
            $teamLookup = $pdo->prepare(
                'SELECT team_id FROM org_team_assignments WHERE employee_id = :employee_id ORDER BY team_id LIMIT 1'
            );

            $added = 0;
            $skipped = [];
            $auditEntries = [];

            $pdo->beginTransaction();
            foreach ($rows as $index => $row) {
                $line = isset($row['line']) ? (int) $row['line'] : ($index + 1);
                $employeeName = trim((string) ($row['employee_name'] ?? ''));

                try {
                    if ($employeeName === '') {
                        throw new InvalidArgumentException('missing employee name');
                    }
                    $amount = bonusRequestAmount($row['bonus_amount'] ?? null);
                    $currency = bonusRequestCurrency($row['currency'] ?? null);
                    $employeeId = isset($row['employee_id']) && $row['employee_id'] !== '' && $row['employee_id'] !== null
                        ? (int) $row['employee_id']
                        : null;

                    // Re-checked inside the transaction, so a row inserted moments ago by
                    // this same loop already counts as present.
                    $duplicate = bonusFindDuplicate($pdo, $bonusType, $year, $month, $employeeId, $employeeName);
                    if ($duplicate !== null) {
                        $skipped[] = ['line' => $line, 'name' => $employeeName, 'reason' => 'already on this month'];
                        continue;
                    }

                    $teamId = null;
                    if ($employeeId !== null) {
                        $teamLookup->execute(['employee_id' => $employeeId]);
                        $resolved = $teamLookup->fetchColumn();
                        if ($resolved !== false) {
                            $teamId = (int) $resolved;
                        }
                    }

                    // A stale company id (retired between preview and upload) costs the
                    // company, not the row.
                    $companyId = null;
                    try {
                        $companyId = bonusResolveCompanyId($pdo, $row['company_id'] ?? null);
                    } catch (InvalidArgumentException $companyError) {
                        $companyId = null;
                    }

                    $comments = trim((string) ($row['comments'] ?? ''));
                    if (mb_strlen($comments) > BONUS_MAX_COMMENT_LENGTH) {
                        $comments = mb_substr($comments, 0, BONUS_MAX_COMMENT_LENGTH);
                    }
                    $teamName = trim((string) ($row['team_name'] ?? ''));

                    $insert->execute([
                        'bonus_type' => $bonusType,
                        'year' => $year,
                        'month' => $month,
                        'employee_id' => $employeeId,
                        'employee_name' => $employeeName,
                        'team_id' => $teamId,
                        'team_name' => $teamName === '' ? null : $teamName,
                        'company_id' => $companyId,
                        'bonus_amount' => $amount,
                        'currency' => $currency,
                        'comments' => $comments === '' ? null : $comments
                    ]);

                    $auditEntries[] = [
                        'bonus_type' => $bonusType,
                        'period_year' => $year,
                        'period_month' => $month,
                        'bonus_row_id' => (int) $pdo->lastInsertId(),
                        'employee_id' => $employeeId,
                        'employee_name' => $employeeName,
                        'action' => 'create',
                        'new_value' => 'Imported from file · ' . bonusAuditRowSummary(bonusAuditSnapshot($pdo, [
                            'employee_name' => $employeeName,
                            'team_name' => $teamName,
                            'company_id' => $companyId,
                            'bonus_amount' => $amount,
                            'currency' => $currency,
                            'days_worked_override' => null,
                            'comments' => $comments
                        ]))
                    ];
                    $added++;
                } catch (InvalidArgumentException $rowError) {
                    $skipped[] = ['line' => $line, 'name' => $employeeName ?: '(no name)', 'reason' => $rowError->getMessage()];
                }
            }
            $pdo->commit();
            bonusAuditLogAll($pdo, $auditEntries);

            echo json_encode(['success' => true, 'added' => $added, 'skipped' => $skipped]);
        } catch (InvalidArgumentException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        } catch (Exception $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    if (($data['action'] ?? '') === 'copy_previous') {
        try {
            [$year, $month] = bonusRequestPeriod($data);
            $bonusType = bonusRequestType($data);

            // Every write into a month goes through this: an approved period is frozen, and
            // the read-only cells on screen are the courtesy, not the guarantee.
            bonusAssertPeriodEditable($pdo, $bonusType, $year, $month);
            [$sourceYear, $sourceMonth] = bonusPreviousPeriod($year, $month);

            // The whole previous month, like the list itself (no team scoping).
            $stmt = $pdo->prepare(
                "SELECT b.employee_id, b.employee_name, b.team_id, b.team_name, b.company_id,
                        b.bonus_amount, b.currency
                 FROM org_bonus_employees b
                 WHERE b.bonus_type = :bonus_type
                   AND b.period_year = :year
                   AND b.period_month = :month
                 ORDER BY b.employee_name"
            );
            $stmt->execute([
                'bonus_type' => $bonusType,
                'year' => $sourceYear,
                'month' => $sourceMonth
            ]);
            $sourceRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $insert = $pdo->prepare(
                "INSERT INTO org_bonus_employees
                    (bonus_type, period_year, period_month, employee_id, employee_name,
                     team_id, team_name, company_id, bonus_amount, currency)
                 VALUES
                    (:bonus_type, :year, :month, :employee_id, :employee_name,
                     :team_id, :team_name, :company_id, :bonus_amount, :currency)"
            );

            $copied = 0;
            $skipped = 0;
            // Collected during the transaction, written after it commits: an audit entry for
            // a copy that then rolled back would be a lie.
            $copiedRows = [];
            $sourceLabel = date('F Y', strtotime(sprintf('%04d-%02d-01', $sourceYear, $sourceMonth)));

            $pdo->beginTransaction();
            foreach ($sourceRows as $row) {
                $employeeId = $row['employee_id'] === null ? null : (int) $row['employee_id'];

                // Re-checked per row inside the transaction, so rows inserted a moment ago
                // by this same loop count as already present too.
                if (bonusFindDuplicate($pdo, $bonusType, $year, $month, $employeeId, (string) $row['employee_name']) !== null) {
                    $skipped++;
                    continue;
                }

                $insert->execute([
                    'bonus_type' => $bonusType,
                    'year' => $year,
                    'month' => $month,
                    'employee_id' => $employeeId,
                    'employee_name' => $row['employee_name'],
                    'team_id' => $row['team_id'] === null ? null : (int) $row['team_id'],
                    'team_name' => $row['team_name'],
                    'company_id' => $row['company_id'] === null ? null : (int) $row['company_id'],
                    'bonus_amount' => $row['bonus_amount'],
                    'currency' => $row['currency']
                ]);

                // One entry per employee rather than one for the batch: each of these IS an
                // employee being added to a month, and the log is asked "when did she join
                // this list" far more often than "when was the copy run".
                $copiedRows[] = [
                    'bonus_type' => $bonusType,
                    'period_year' => $year,
                    'period_month' => $month,
                    'bonus_row_id' => (int) $pdo->lastInsertId(),
                    'employee_id' => $employeeId,
                    'employee_name' => $row['employee_name'],
                    'action' => 'create',
                    'new_value' => 'Copied from ' . $sourceLabel . ' · '
                        . bonusAuditRowSummary(bonusAuditSnapshot($pdo, $row + [
                            'days_worked_override' => null,
                            'comments' => null
                        ]))
                ];
                $copied++;
            }
            $pdo->commit();
            bonusAuditLogAll($pdo, $copiedRows);

            echo json_encode([
                'success' => true,
                'copied' => $copied,
                'skipped' => $skipped,
                'source' => ['year' => $sourceYear, 'month' => $sourceMonth, 'label' => $sourceLabel]
            ]);
        } catch (InvalidArgumentException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        } catch (Exception $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    try {
        [$year, $month] = bonusRequestPeriod($data);
        $bonusType = bonusRequestType($data);

        // As above: enrolling somebody into a signed-off month is a change to that month.
        bonusAssertPeriodEditable($pdo, $bonusType, $year, $month);

        $employeeName = trim((string) ($data['employee_name'] ?? ''));
        if ($employeeName === '') {
            throw new InvalidArgumentException('employee_name is required.');
        }

        $employeeId = isset($data['employee_id']) && $data['employee_id'] !== ''
            ? (int) $data['employee_id']
            : null;
        $teamId = isset($data['team_id']) && $data['team_id'] !== ''
            ? (int) $data['team_id']
            : null;
        $teamName = trim((string) ($data['team_name'] ?? ''));

        // The Add Employee modal fills the Team field from the roster, which carries the
        // team's NAME. Resolving the id here rather than asking the client for it keeps the
        // row tied to the actual team, so a rename follows through and Workdays can be
        // counted against that team's own holidays. LIMIT 1 because an employee can sit in
        // two teams; the row records the one the assignment table lists first, and the
        // column is editable if that is the wrong one.
        if ($teamId === null && $employeeId !== null) {
            $lookup = $pdo->prepare(
                'SELECT team_id FROM org_team_assignments WHERE employee_id = :employee_id ORDER BY team_id LIMIT 1'
            );
            $lookup->execute(['employee_id' => $employeeId]);
            $resolved = $lookup->fetchColumn();
            if ($resolved !== false) {
                $teamId = (int) $resolved;
            }
        }
        $companyId = bonusResolveCompanyId($pdo, $data['company_id'] ?? null);
        $amount = bonusRequestAmount($data['bonus_amount'] ?? null);
        $currency = bonusRequestCurrency($data['currency'] ?? null);

        // One person, one row per month -- see bonusFindDuplicate(). The unique key alone
        // does not get there: it cannot see a manual row (NULL employee_id) as a repeat of
        // a linked one, and it is not what stops an employee who sits on two teams from
        // being added once per team.
        $duplicate = bonusFindDuplicate($pdo, $bonusType, $year, $month, $employeeId, $employeeName);
        if ($duplicate !== null) {
            http_response_code(409);
            echo json_encode([
                'success' => false,
                'error' => bonusDuplicateMessage($duplicate, $year, $month)
            ]);
            exit;
        }

        $stmt = $pdo->prepare(
            "INSERT INTO org_bonus_employees
                (bonus_type, period_year, period_month, employee_id, employee_name,
                 team_id, team_name, company_id, bonus_amount, currency)
             VALUES
                (:bonus_type, :year, :month, :employee_id, :employee_name,
                 :team_id, :team_name, :company_id, :bonus_amount, :currency)"
        );
        $stmt->execute([
            'bonus_type' => $bonusType,
            'year' => $year,
            'month' => $month,
            'employee_id' => $employeeId,
            'employee_name' => $employeeName,
            'team_id' => $teamId,
            'team_name' => $teamName === '' ? null : $teamName,
            'company_id' => $companyId,
            'bonus_amount' => $amount,
            'currency' => $currency
        ]);

        $newId = (int) $pdo->lastInsertId();

        bonusAuditLog($pdo, [
            'bonus_type' => $bonusType,
            'period_year' => $year,
            'period_month' => $month,
            'bonus_row_id' => $newId,
            'employee_id' => $employeeId,
            'employee_name' => $employeeName,
            'action' => 'create',
            'new_value' => bonusAuditRowSummary(bonusAuditSnapshot($pdo, [
                'employee_name' => $employeeName,
                'team_name' => $teamName,
                'company_id' => $companyId,
                'bonus_amount' => $amount,
                'currency' => $currency,
                'days_worked_override' => null,
                'comments' => null
            ]))
        ]);

        echo json_encode(['success' => true, 'id' => $newId]);
    } catch (PDOException $e) {
        if ((int) $e->getCode() === 23000) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => "That employee is already on this month's bonus list."]);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
    } catch (InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'PUT') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = isset($data['id']) ? (int) $data['id'] : 0;

    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'id is required']);
        exit;
    }

    // Only the fields actually present are touched, so the List view can save one edited
    // cell without shipping (and risking clobbering) the rest of the row.
    $assignments = [];
    $params = ['id' => $id];

    try {
        $current = $pdo->prepare(
            // Every column, because the audit diff compares the row before against the row
            // after and cannot do that from the handful the validation needs.
            'SELECT * FROM org_bonus_employees WHERE id = :id'
        );
        $current->execute(['id' => $id]);
        $row = $current->fetch(PDO::FETCH_ASSOC);

        // The row names its own month, which is the one that has to be open.
        bonusAssertRowEditable($pdo, $id);

        if (!$row) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'That bonus row no longer exists.']);
            exit;
        }

        if (array_key_exists('employee_name', $data)) {
            $employeeName = trim((string) $data['employee_name']);
            if ($employeeName === '') {
                throw new InvalidArgumentException('employee_name cannot be empty.');
            }
            $assignments[] = 'employee_name = :employee_name';
            $params['employee_name'] = $employeeName;
        }

        // Sent when the List view's Employee cell picks a different person out of the
        // roster. NULL detaches the row from DeskTime and makes it a manual entry, which is
        // also what a name typed over one the roster does not have amounts to. The unique
        // key is what stops the same person appearing twice in one month.
        if (array_key_exists('employee_id', $data)) {
            $newEmployeeId = ($data['employee_id'] === null || $data['employee_id'] === '')
                ? null
                : (int) $data['employee_id'];
            $assignments[] = 'employee_id = :employee_id';
            $params['employee_id'] = $newEmployeeId;
        }

        // Any edit that changes WHO the row is about has to clear the same one-per-month
        // bar an insert does -- swapping a row onto somebody already on the list, or typing
        // a manual name that matches one, would otherwise walk straight around it.
        $duplicateNameConfirmed = false;
        if (array_key_exists('employee_id', $params) || array_key_exists('employee_name', $params)) {
            $checkEmployeeId = array_key_exists('employee_id', $params)
                ? $params['employee_id']
                : ($row['employee_id'] === null ? null : (int) $row['employee_id']);
            $checkName = $params['employee_name'] ?? $row['employee_name'] ?? '';

            $duplicate = bonusFindDuplicate(
                $pdo,
                $row['bonus_type'],
                (int) $row['period_year'],
                (int) $row['period_month'],
                $checkEmployeeId,
                (string) $checkName,
                $id
            );
            if ($duplicate !== null) {
                http_response_code(409);
                echo json_encode([
                    'success' => false,
                    'error' => bonusDuplicateMessage($duplicate, (int) $row['period_year'], (int) $row['period_month'])
                ]);
                exit;
            }

            // What the hard rule lets through on purpose -- another row with the same NAME
            // but its own DeskTime id -- is a warning on an edit, not a wall: renaming onto
            // it is usually a slip of the wrong row, occasionally deliberate. The save is
            // held until the request comes back carrying the user's explicit confirmation,
            // so the decision (and its risk) is theirs, on the record.
            //
            // Only when the identity actually MOVES, though. A request that re-sends the
            // row's current name unchanged (an API caller bundling fields) is not a rename,
            // and warning about a collision the row already lived with would cry wolf.
            $nameChanged = array_key_exists('employee_name', $params)
                && (string) $params['employee_name'] !== (string) ($row['employee_name'] ?? '');
            $idChanged = array_key_exists('employee_id', $params)
                && $params['employee_id'] !== ($row['employee_id'] === null ? null : (int) $row['employee_id']);

            $collision = ($nameChanged || $idChanged) ? bonusFindNameCollision(
                $pdo,
                $row['bonus_type'],
                (int) $row['period_year'],
                (int) $row['period_month'],
                (string) $checkName,
                $id
            ) : null;
            if ($collision !== null && empty($data['confirm_duplicate_name'])) {
                http_response_code(409);
                echo json_encode([
                    'success' => false,
                    'needs_confirmation' => true,
                    'error' => '"' . $collision['employee_name'] . '" is already on this list.',
                    'existing' => [
                        'id' => (int) $collision['id'],
                        'employee_id' => $collision['employee_id'] === null ? null : (int) $collision['employee_id'],
                        'employee_name' => $collision['employee_name'],
                        'team_name' => $collision['team_name'] ?? ''
                    ]
                ]);
                exit;
            }
            $duplicateNameConfirmed = $collision !== null;
        }

        // team_id present wins: the cell picked a real team. team_name alone is free text,
        // and clears the link -- keeping the old team_id would let the JOIN in GET overwrite
        // what the user just wrote.
        if (array_key_exists('team_id', $data)) {
            $newTeamId = ($data['team_id'] === null || $data['team_id'] === '')
                ? null
                : (int) $data['team_id'];
            $assignments[] = 'team_id = :team_id';
            $params['team_id'] = $newTeamId;
            if (array_key_exists('team_name', $data)) {
                $assignments[] = 'team_name = :team_name';
                $params['team_name'] = trim((string) $data['team_name']) ?: null;
            }
        } elseif (array_key_exists('team_name', $data)) {
            $teamName = trim((string) $data['team_name']);
            $assignments[] = 'team_name = :team_name';
            $params['team_name'] = $teamName === '' ? null : $teamName;
            $assignments[] = 'team_id = NULL';
        }

        // Validated against the catalog rather than left to the foreign key, so a company
        // retired between the page loading and the cell being saved gets a sentence the
        // user can act on instead of a constraint violation.
        if (array_key_exists('company_id', $data)) {
            $assignments[] = 'company_id = :company_id';
            $params['company_id'] = bonusResolveCompanyId($pdo, $data['company_id']);
        }

        if (array_key_exists('days_worked', $data)) {
            $override = bonusOptionalCount($data['days_worked'], 'Days Employee Worked');

            // A day the month did not have cannot be earned, so the override is bounded by
            // Workdays -- computed for the team this row will belong to AFTER this request,
            // not before it, so changing the team and the days in one go still validates
            // against the right calendar.
            if ($override !== null) {
                [$from, $to] = bonusPeriodRange((int) $row['period_year'], (int) $row['period_month']);
                $workdays = bonusWorkdays($pdo, $from, $to);

                $teamId = array_key_exists('team_id', $params)
                    ? $params['team_id']
                    : ($row['team_id'] === null ? null : (int) $row['team_id']);
                $employeeId = array_key_exists('employee_id', $params)
                    ? $params['employee_id']
                    : ($row['employee_id'] === null ? null : (int) $row['employee_id']);
                if ($teamId === null && $employeeId !== null) {
                    $teamId = bonusEmployeeTeamMap($pdo, [$employeeId])[$employeeId]['team_id'] ?? null;
                }

                $limit = ($teamId !== null && isset($workdays['by_team'][$teamId]))
                    ? $workdays['by_team'][$teamId]
                    : $workdays['default'];

                if ($override > $limit) {
                    throw new InvalidArgumentException(
                        "Days Employee Worked cannot be more than the $limit workdays in that month."
                    );
                }
            }

            $assignments[] = 'days_worked_override = :days_worked_override';
            $params['days_worked_override'] = $override;
        }

        if (array_key_exists('bonus_amount', $data)) {
            $assignments[] = 'bonus_amount = :bonus_amount';
            $params['bonus_amount'] = bonusRequestAmount($data['bonus_amount']);
        }

        if (array_key_exists('currency', $data)) {
            $assignments[] = 'currency = :currency';
            $params['currency'] = bonusRequestCurrency($data['currency']);
        }

        if (array_key_exists('comments', $data)) {
            $comments = trim((string) ($data['comments'] ?? ''));
            if (mb_strlen($comments) > BONUS_MAX_COMMENT_LENGTH) {
                throw new InvalidArgumentException(
                    'A comment cannot be longer than ' . BONUS_MAX_COMMENT_LENGTH . ' characters.'
                );
            }
            $assignments[] = 'comments = :comments';
            $params['comments'] = $comments === '' ? null : $comments;
        }

        if (empty($assignments)) {
            throw new InvalidArgumentException('Nothing to update.');
        }

        $stmt = $pdo->prepare('UPDATE org_bonus_employees SET ' . implode(', ', $assignments) . ' WHERE id = :id');
        $stmt->execute($params);

        // Read back rather than reconstructed: team_name and company_name are resolved from
        // ids on the way out, so the only reliable "after" is the stored row itself.
        $reread = $pdo->prepare('SELECT * FROM org_bonus_employees WHERE id = :id');
        $reread->execute(['id' => $id]);
        $after = $reread->fetch(PDO::FETCH_ASSOC) ?: [];

        $auditEntries = bonusAuditDiff(
            bonusAuditSnapshot($pdo, $row),
            bonusAuditSnapshot($pdo, $after),
            [
                'bonus_type' => $row['bonus_type'],
                'period_year' => (int) $row['period_year'],
                'period_month' => (int) $row['period_month'],
                'bonus_row_id' => $id,
                'employee_id' => $after['employee_id'] ?? $row['employee_id'],
                'employee_name' => $after['employee_name'] ?? $row['employee_name']
            ]
        );

        // "At their own risk" is only meaningful if the record shows the risk was taken:
        // the History entry for this rename says the duplicate warning was accepted.
        if ($duplicateNameConfirmed) {
            foreach ($auditEntries as &$auditEntry) {
                if ($auditEntry['field'] === 'Employee Name') {
                    $auditEntry['new_value'] .= ' — duplicate name, confirmed by the user';
                }
            }
            unset($auditEntry);
        }

        bonusAuditLogAll($pdo, $auditEntries);

        echo json_encode(['success' => true]);
    } catch (PDOException $e) {
        if ((int) $e->getCode() === 23000) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => "That employee is already on this month's bonus list."]);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
    } catch (InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;

    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'id is required']);
        exit;
    }

    try {
        bonusAssertRowEditable($pdo, $id);

        // Read before deleting: afterwards there is nothing left to describe.
        $before = $pdo->prepare('SELECT * FROM org_bonus_employees WHERE id = :id');
        $before->execute(['id' => $id]);
        $row = $before->fetch(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare('DELETE FROM org_bonus_employees WHERE id = :id');
        $stmt->execute(['id' => $id]);

        if ($row && $stmt->rowCount() > 0) {
            bonusAuditLog($pdo, [
                'bonus_type' => $row['bonus_type'],
                'period_year' => (int) $row['period_year'],
                'period_month' => (int) $row['period_month'],
                'bonus_row_id' => $id,
                'employee_id' => $row['employee_id'],
                'employee_name' => $row['employee_name'],
                'action' => 'delete',
                'old_value' => bonusAuditRowSummary(bonusAuditSnapshot($pdo, $row))
            ]);
        }

        echo json_encode(['success' => true, 'deleted' => $stmt->rowCount()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
?>
