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
