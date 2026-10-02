<?php
/**
 * get_hr_milestones.php
 *
 * HR > Milestones: every birthday and work anniversary in one calendar year.
 *
 * Reads odoo_employee_data and nothing else -- that table is already the platform's copy
 * of hr_employee, synced by sync_odoo_employees.php, so there is no second employee source
 * here and no employee row is duplicated. The columns used are the ones that table actually
 * has: employee_name, date_of_birth, entry_date, is_active.
 *
 * A whole year rather than the selected month, because the screen needs both: the month
 * view filters this down, and the employee search has to reach across months -- looking
 * somebody up is how you find out *when* their birthday is, so restricting the search to
 * the month already on screen would answer "nothing found" almost every time. A year is
 * roughly 400 rows for this company, small enough that one request serves both and the
 * month arrows stop hitting the network at all.
 *
 * Both lists are returned on every call rather than one list per tab. The All / Birthdays
 * / Anniversaries tabs, the Grid / List views and the search are presentations of this one
 * dataset, so their rules cannot drift apart.
 *
 * Ages and years-of-service are computed here and the source years are never sent to the
 * browser: a payload carrying date_of_birth would put the birth year one devtools panel
 * away from a screen whose whole point is that it does not show it.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

session_start();
if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Not authenticated']);
    exit;
}

/**
 * A usable date column value. MySQL DATE columns in this schema hold NULL for "Odoo had
 * nothing", but a zero date is what a legacy import leaves behind, and both have to drop
 * out of the results silently -- a missing birthday is not an error anyone should see.
 */
function milestoneValidDate($value)
{
    if (empty($value) || strpos($value, '0000-00-00') === 0) {
        return null;
    }
    // The leading '!' zeroes every field the format does not name. Without it the object
    // carries the *current* clock time, which is harmless when all you read is the month
    // and day but quietly costs a day when the date is subtracted from today to measure
    // tenure.
    $parsed = DateTime::createFromFormat('!Y-m-d', substr($value, 0, 10));
    return $parsed ? $parsed : null;
}

/**
 * Today's day and month, in the given year, at midnight.
 *
 * setDate() would roll 29 February into 1 March on a non-leap year, which only bites on
 * one day every four years and is exactly the kind of thing nobody would find; the day is
 * clamped to the length of the target month instead.
 */
function milestoneReferenceDate($year, DateTime $now)
{
    $month = (int) $now->format('n');
    $day = min((int) $now->format('j'), (int) date('t', mktime(0, 0, 0, $month, 1, $year)));

    $reference = new DateTime('today');
    $reference->setDate($year, $month, $day);
    return $reference;
}

try {
    $now = new DateTime();
    $year = isset($_GET['year']) ? (int) $_GET['year'] : (int) $now->format('Y');

    if ($year < 1970 || $year > 2999) {
        throw new Exception('Year is out of range');
    }

    // What the Tenure toggle measures against: today's calendar position, moved into the
    // selected year. For the current year that is simply today, so the toggle still answers
    // "how long has this person been here". For another year it moves by whole years, which
    // keeps it consistent with the two numbers beside it -- the age and the anniversary
    // count both follow the year selector, and a tenure frozen at today's date contradicted
    // them: a card could read "2 years with the company" and, with the toggle on, still say
    // "1 year 5 months".
    $reference = milestoneReferenceDate($year, $now);

    // Active employees only, which is the existing is_active flag carried over from Odoo --
    // no second status system. One pass over the table: an employee can own both a birthday
    // and an anniversary, so the row is fetched once and expanded below.
    $sql = "SELECT employee_id, employee_name, date_of_birth, entry_date
            FROM odoo_employee_data
            WHERE is_active = 1
              AND employee_name IS NOT NULL AND employee_name <> ''
              AND (date_of_birth IS NOT NULL OR entry_date IS NOT NULL)";
    $stmt = $pdo->query($sql);

    $birthdays = [];
    $anniversaries = [];

    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $name = trim($row['employee_name']);

        $birth = milestoneValidDate($row['date_of_birth']);
        if ($birth) {
            // The age the employee reaches on that date in the selected year -- the same
            // shape as the anniversary count below, and the reason the card can say "34
            // years old" without ever naming 1992. Viewing a past month therefore shows the
            // age they turned then, not the age they are now, which is what a milestone
            // list is being asked for.
            $age = $year - (int) $birth->format('Y');

            $birthdays[] = [
                'employee_id' => (int) $row['employee_id'],
                'name' => $name,
                'month' => (int) $birth->format('n'),
                'day' => (int) $birth->format('j'),
                'type' => 'birthday',
                // Null rather than absent for a nonsensical age (a birth year after the
                // month being viewed), so the UI has one thing to test.
                'age' => $age > 0 ? $age : null
            ];
        }

        $entry = milestoneValidDate($row['entry_date']);
        if ($entry) {
            $years = $year - (int) $entry->format('Y');
            // The hire month itself is not an anniversary (0 years), and a month earlier
            // than the hire date is not one either. Both would otherwise render as a card
            // claiming "0 years with the company" on the day someone started.
            if ($years >= 1) {
                // Full tenure for the Tenure toggle, measured to $reference (see above).
                // Sent as parts so the wording stays with the UI, and so the hire date is
                // never shipped as a date. An employee who had not joined yet at that point
                // yields no tenure rather than a negative one -- the UI then falls back to
                // the plain year count.
                $tenure = null;
                if ($entry <= $reference) {
                    $elapsed = $entry->diff($reference);
                    $tenure = [
                        'years' => $elapsed->y,
                        'months' => $elapsed->m,
                        'days' => $elapsed->d
                    ];
                }

                $anniversaries[] = [
                    'employee_id' => (int) $row['employee_id'],
                    'name' => $name,
                    'month' => (int) $entry->format('n'),
                    'day' => (int) $entry->format('j'),
                    'type' => 'anniversary',
                    'years' => $years,
                    'tenure' => $tenure
                ];
            }
        }
    }

    // Chronological, then by name: two people sharing a day stay together and read
    // alphabetically. Sorted here so every view inherits the same order -- the month view
    // slices this without re-sorting, and the search reads it across months as it stands.
    $chronological = function ($a, $b) {
        return $a['month'] <=> $b['month']
            ?: $a['day'] <=> $b['day']
            ?: strcasecmp($a['name'], $b['name']);
    };
    usort($birthdays, $chronological);
    usort($anniversaries, $chronological);

    echo json_encode([
        'success' => true,
        'year' => $year,
        'birthdays' => $birthdays,
        'anniversaries' => $anniversaries
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
