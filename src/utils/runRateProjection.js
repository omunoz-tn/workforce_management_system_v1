/**
 * Arithmetic behind the Run Rate Report's projection view, kept free of React so the
 * panel, the accuracy modal and the simulator all total hours the same way.
 *
 * Rows come from get_run_rate_projection.php, one per (employee, team). Every total nets
 * lunch at the aggregate — sum of scheduled minus sum of lunch, floored at zero — which is
 * how the rest of the report computes it (StatReportView's runRateCalc).
 */

const num = (value) => Number(value || 0);

/** Share of projected hours backed by employees with enough history, as a label. */
export const confidenceLevel = (highShare) => {
    if (highShare === null || highShare === undefined) return null;
    if (highShare >= 0.8) return 'High';
    if (highShare >= 0.5) return 'Medium';
    return 'Low';
};

/**
 * Totals for the rows whose team is in `teams` (a Set; null means every team).
 *
 * `teamDates` maps team -> projected dates with scheduled hours; their union for the
 * scope is how many working days are left to recover a shortfall in.
 */
export const summarizeProjection = (rows, teamDates, teams, goalPct) => {
    const inScope = (rows || []).filter(r => !Number(r.is_excluded) && (!teams || teams.has(r.team_name)));

    let actualToDate = 0, scheduledToDate = 0, lunchToDate = 0;
    let projectedActual = 0, projectedScheduled = 0, projectedLunch = 0, highAdjusted = 0;
    let realActual = 0, realScheduled = 0, realLunch = 0, hasReal = false;
    const employees = new Set();

    inScope.forEach(r => {
        employees.add(r.employee_id);
        actualToDate += num(r.actual_to_date);
        scheduledToDate += num(r.scheduled_to_date);
        lunchToDate += num(r.lunch_to_date);
        projectedActual += num(r.projected_actual);
        projectedScheduled += num(r.projected_scheduled);
        projectedLunch += num(r.projected_lunch);
        if (r.confidence === 'high') {
            highAdjusted += Math.max(num(r.projected_scheduled) - num(r.projected_lunch), 0);
        }
        if (r.real_actual !== undefined) {
            hasReal = true;
            realActual += num(r.real_actual);
            realScheduled += num(r.real_scheduled);
            realLunch += num(r.real_lunch);
        }
    });

    const adjustedToDate = Math.max(scheduledToDate - lunchToDate, 0);
    const adjustedProjected = Math.max(projectedScheduled - projectedLunch, 0);
    const totalActual = actualToDate + projectedActual;
    const totalScheduled = adjustedToDate + adjustedProjected;

    const dates = new Set();
    Object.entries(teamDates || {}).forEach(([team, list]) => {
        if (!teams || teams.has(team)) (list || []).forEach(d => dates.add(d));
    });
    const remainingDays = dates.size;

    const goalHours = (num(goalPct) / 100) * totalScheduled;
    const shortfall = Math.max(goalHours - totalActual, 0);

    const highShare = adjustedProjected > 0 ? highAdjusted / adjustedProjected : null;

    const summary = {
        employees: employees.size,
        actualToDate,
        scheduledToDate: adjustedToDate,
        projectedActual,
        projectedScheduled: adjustedProjected,
        totalActual,
        totalScheduled,
        toDatePct: adjustedToDate > 0 ? (actualToDate / adjustedToDate) * 100 : null,
        projectedPct: totalScheduled > 0 ? (totalActual / totalScheduled) * 100 : null,
        projectedMissed: Math.max(totalScheduled - totalActual, 0),
        // The rate the not-yet-worked hours are expected at; what added staff would run at.
        projectedRate: adjustedProjected > 0 ? projectedActual / adjustedProjected : 1,
        remainingDays,
        remainingDates: [...dates].sort(),
        shortfall,
        // null when the goal cannot be reached by working more: no working days are left.
        extraPerDay: shortfall <= 0 ? 0 : (remainingDays > 0 ? shortfall / remainingDays : null),
        highShare,
        confidence: confidenceLevel(highShare),
    };

    if (hasReal) {
        const realAdjusted = Math.max(realScheduled - realLunch, 0);
        const realTotalScheduled = adjustedToDate + realAdjusted;
        summary.realPct = realTotalScheduled > 0 ? ((actualToDate + realActual) / realTotalScheduled) * 100 : null;
    }
    return summary;
};

/** One summary per team present in the rows, worst projected Run Rate first. */
export const summarizeByTeam = (rows, teamDates, teams, goalPct) => {
    const names = [...new Set((rows || []).map(r => r.team_name))]
        .filter(name => !teams || teams.has(name));
    return names
        .map(name => ({ team: name, ...summarizeProjection(rows, teamDates, new Set([name]), goalPct) }))
        .filter(s => s.employees > 0)
        .sort((a, b) => (a.projectedPct ?? Infinity) - (b.projectedPct ?? Infinity) || a.team.localeCompare(b.team));
};

/**
 * What-if on top of a summary. Nothing is saved; it only answers "where would we land".
 *
 *   addPeople      headcount change from `fromDate` (negative for people leaving)
 *   hoursPerDay    scheduled hours (net of lunch) each of them works per remaining working day
 *   peopleRatePct  the compliance those people run at; blank = the scope's projected rate
 *   overtimePerDay extra hours worked across the whole scope per remaining working day
 *
 * People added at the scope's own rate move hours, not the percentage — the Run Rate is a
 * ratio — which is why their rate is an input. Overtime is worked time on top of the
 * schedule, so it adds to actual hours only.
 */
export const simulateProjection = (summary, { addPeople = 0, hoursPerDay = 0, peopleRatePct = '', overtimePerDay = 0, fromDate = '' }) => {
    const days = summary.remainingDates.filter(d => !fromDate || d >= fromDate).length;
    const peopleRate = peopleRatePct === '' || peopleRatePct === null || peopleRatePct === undefined
        ? summary.projectedRate
        : num(peopleRatePct) / 100;
    const addedScheduled = num(addPeople) * num(hoursPerDay) * days;
    const addedActual = addedScheduled * peopleRate + num(overtimePerDay) * days;

    const totalActual = Math.max(summary.totalActual + addedActual, 0);
    const totalScheduled = Math.max(summary.totalScheduled + addedScheduled, 0);
    const projectedPct = totalScheduled > 0 ? (totalActual / totalScheduled) * 100 : null;

    return {
        days,
        addedScheduled,
        addedActual,
        totalActual,
        totalScheduled,
        projectedPct,
        projectedMissed: Math.max(totalScheduled - totalActual, 0),
        deltaPct: projectedPct !== null && summary.projectedPct !== null ? projectedPct - summary.projectedPct : null,
    };
};

/**
 * Default goal: the floor of the best configured Run Rate band (highest non-blinking floor
 * between 90% and 100%) — the green band, 98%, on the default setup. Falls back to 98 when
 * no ranges are configured, matching getRunRateBand's fallback. The viewer can change it.
 */
export const defaultGoalFromRanges = (ranges) => {
    const floors = (ranges || [])
        .filter(r => !Number(r.is_blinking))
        .map(r => Number(r.range_start))
        .filter(v => Number.isFinite(v) && v >= 90 && v <= 100)
        .sort((a, b) => b - a);
    return floors.length ? floors[0] : 98;
};

const WEEKDAY_NAMES = { 1: 'Mondays', 2: 'Tuesdays', 3: 'Wednesdays', 4: 'Thursdays', 5: 'Fridays', 6: 'Saturdays', 7: 'Sundays' };

/** How many of each kind the recommendations list, so the card stays readable. */
const REC_TOP_EMPLOYEES = 5;
const REC_TOP_TEAMS = 3;
const REC_TOP_WEEKDAY_TEAMS = 2;
const REC_REVIEW_NAMES = 6;
/** A weekday is called out only when it runs at least this many points below the others. */
const REC_WEEKDAY_MIN_GAP = 3;
/**
 * Weekdays with little scheduled time (a weekend shift or two) are left out: a few hours
 * make a percentage that swings on one person.
 */
const REC_WEEKDAY_MIN_SHARE = 0.25;

/**
 * The weakest weekday in `byWeekday` ({ wd: { actual, scheduled } }) against the rest,
 * or null when no weekday stands out by REC_WEEKDAY_MIN_GAP points.
 */
const weakestWeekday = (byWeekday) => {
    const entries = Object.entries(byWeekday || {})
        .map(([wd, v]) => ({ wd: Number(wd), actual: num(v.actual), scheduled: num(v.scheduled) }))
        .filter(e => e.scheduled > 0);
    if (entries.length < 2) return null;
    const busiest = Math.max(...entries.map(e => e.scheduled));
    const days = entries.filter(e => e.scheduled >= busiest * REC_WEEKDAY_MIN_SHARE);
    if (days.length < 2) return null;

    let worst = null;
    days.forEach(e => {
        const rest = days.filter(o => o.wd !== e.wd);
        const restScheduled = rest.reduce((s, o) => s + o.scheduled, 0);
        const restPct = restScheduled > 0 ? (rest.reduce((s, o) => s + o.actual, 0) / restScheduled) * 100 : null;
        const pctValue = (e.actual / e.scheduled) * 100;
        if (restPct === null) return;
        const gap = restPct - pctValue;
        if (!worst || gap > worst.gap) worst = { wd: e.wd, name: WEEKDAY_NAMES[e.wd], pct: pctValue, restPct, gap };
    });
    return worst && worst.gap >= REC_WEEKDAY_MIN_GAP ? worst : null;
};

/**
 * What it would take to reach the goal, for the projection's recommendations card.
 * Same scope rules as summarizeProjection: rows whose team is in `teams` (null = all),
 * excluded employees left out.
 *
 *   status      'on-track' | 'behind' | 'unreachable' (no working days left)
 *   employees   the largest gaps to the goal, each with the hours per remaining day that
 *               would close it, and how much of the shortfall closing them all would cover
 *   teams       teams projected below the goal, largest shortfall first (only when the
 *               scope holds more than one team)
 *   weekday     the scope's weakest weekday in the real Run Rate of the last weeks
 *               (`weekdayHistory`, absences included), and the teams where it shows most
 *   review      employees with no worked day in the history window, projected at their
 *               team's rate: they may have left, be on leave, or be system accounts
 */
export const buildRecommendations = (rows, teamDates, teams, goalPct, weekdayHistory) => {
    const summary = summarizeProjection(rows, teamDates, teams, goalPct);
    const goal = num(goalPct) / 100;
    const inScope = (rows || []).filter(r => !Number(r.is_excluded) && (!teams || teams.has(r.team_name)));

    const status = summary.shortfall <= 0 ? 'on-track' : (summary.remainingDays > 0 ? 'behind' : 'unreachable');

    // Employees: gap to the goal over the whole period, recoverable only on the days left.
    const gaps = inScope
        .map(r => {
            const scheduled = Math.max(num(r.scheduled_to_date) - num(r.lunch_to_date), 0)
                + Math.max(num(r.projected_scheduled) - num(r.projected_lunch), 0);
            const actual = num(r.actual_to_date) + num(r.projected_actual);
            const gap = goal * scheduled - actual;
            const days = num(r.projected_days);
            return {
                employeeId: r.employee_id,
                name: r.name,
                team: r.team_name,
                projectedPct: scheduled > 0 ? (actual / scheduled) * 100 : null,
                gap,
                days,
                perDay: days > 0 ? gap / days : null,
            };
        })
        .filter(e => e.gap > 0.01 && e.days > 0)
        .sort((a, b) => b.gap - a.gap);
    const topEmployees = gaps.slice(0, REC_TOP_EMPLOYEES);
    const topGap = topEmployees.reduce((s, e) => s + e.gap, 0);
    const employeesCover = summary.shortfall > 0 ? Math.min(topGap / summary.shortfall, 1) : null;

    // Teams below the goal.
    const teamNames = [...new Set(inScope.map(r => r.team_name))];
    const teamsBelow = teamNames.length > 1
        ? summarizeByTeam(rows, teamDates, teams, goalPct)
            .filter(t => t.shortfall > 0)
            .sort((a, b) => b.shortfall - a.shortfall)
            .slice(0, REC_TOP_TEAMS)
        : [];

    // Weekday pattern, from the real Run Rate (not the projection, which assumes attendance).
    const history = weekdayHistory || {};
    const scopeWeekdays = {};
    teamNames.forEach(team => {
        Object.entries(history[team] || {}).forEach(([wd, v]) => {
            scopeWeekdays[wd] = scopeWeekdays[wd] || { actual: 0, scheduled: 0 };
            scopeWeekdays[wd].actual += num(v.actual);
            scopeWeekdays[wd].scheduled += num(v.scheduled);
        });
    });
    const scopeWeakest = weakestWeekday(scopeWeekdays);
    const teamWeakest = teamNames.length > 1
        ? teamNames
            .map(team => ({ team, ...(weakestWeekday(history[team]) || {}) }))
            .filter(t => t.wd)
            .sort((a, b) => b.gap - a.gap)
            .slice(0, REC_TOP_WEEKDAY_TEAMS)
        : [];

    // Employees with nothing worked in the history window.
    const review = inScope
        .filter(r => num(r.history_days) === 0 && num(r.projected_days) > 0)
        .map(r => ({ employeeId: r.employee_id, name: r.name, team: r.team_name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
        summary,
        status,
        employees: topEmployees,
        employeesCover,
        teams: teamsBelow,
        weekday: scopeWeakest || teamWeakest.length ? { scope: scopeWeakest, teams: teamWeakest } : null,
        review,
        reviewShown: REC_REVIEW_NAMES,
    };
};
