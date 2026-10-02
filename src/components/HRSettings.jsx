import React, { useEffect, useState } from 'react';
import './ScheduleBoard.css';
import './ScheduleForecastSettings.css';
import './HRSettings.css';
import { normalizeForSearch } from '../utils/search';
import { BONUS_COLUMN_WIDTHS_KEY, saveColumnWidths } from '../reportPreferences';
import BonusApprovalEmailSettings from './BonusApprovalEmailSettings';
import BonusPeriodSettings from './BonusPeriodSettings';

/**
 * Configuration > HR.
 *
 * Four sections. Company is the closed list of companies the organization operates as — a
 * lookup table on purpose, because the screens that read it (HR > Bonus) need everyone
 * picking the same spelling of the same company, which a free-text field cannot promise.
 * Bonus holds the settings the Bonus list reads rather than owns. The last two belong to
 * the approval workflow: the message Finance is sent when a month is signed off, and the
 * lock on a month that has been. Both are deliberately here rather than on the Bonus list —
 * one is a message nobody edits while working a month, and the other undoes a sign-off,
 * which should not sit beside the cells it unlocks.
 *
 * Renaming is offered alongside add and remove because other records will point at these
 * ids: fixing a typo by deleting and re-adding would break every one of those links, while
 * correcting the name in place keeps them.
 */
const HRSettings = () => {
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [draftName, setDraftName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    // The bar a day's DeskTime hours must exceed to count towards a bonus. Kept as a string
    // so the box can hold "7." on the way to "7.5" without being rewritten mid-keystroke.
    const [workedDayHours, setWorkedDayHours] = useState('');
    const [savedWorkedDayHours, setSavedWorkedDayHours] = useState('');
    const [bonusSaving, setBonusSaving] = useState(false);
    const [bonusError, setBonusError] = useState(null);
    const [bonusNotice, setBonusNotice] = useState(null);
    const [layoutCleared, setLayoutCleared] = useState(false);

    const loadCompanies = async () => {
        try {
            const res = await fetch('./api/manage_companies.php');
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not load the company list.');
            setCompanies(json.data || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadCompanies();

        fetch('./api/manage_hr_settings.php')
            .then(res => res.json())
            .then(json => {
                if (!json.success) return;
                const hours = String(json.settings.bonus_worked_day_hours);
                setWorkedDayHours(hours);
                setSavedWorkedDayHours(hours);
            })
            .catch(err => console.error('Failed to load the HR settings', err));
    }, []);

    // Caught here as well as by the unique key, so the common mistake gets an answer without
    // a round trip. Accent- and case-insensitive, matching the column's own collation.
    const isDuplicate = (name, exceptId = null) =>
        companies.some(company =>
            company.id !== exceptId &&
            normalizeForSearch(company.name) === normalizeForSearch(name)
        );

    const handleAdd = async () => {
        const name = draftName.trim();
        setNotice(null);

        if (!name) {
            setError('Enter a company name.');
            return;
        }
        if (isDuplicate(name)) {
            setError(`${name} is already on the list.`);
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const res = await fetch('./api/manage_companies.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not add the company.');
            setDraftName('');
            setNotice(`${name} added.`);
            await loadCompanies();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleRename = async (company, rawName) => {
        const name = rawName.trim();
        if (name === company.name) return;

        setNotice(null);
        if (!name) {
            setError('A company name cannot be empty.');
            await loadCompanies(); // Put the old name back in the box.
            return;
        }
        if (isDuplicate(name, company.id)) {
            setError(`Another company is already called ${name}.`);
            await loadCompanies();
            return;
        }

        setError(null);
        try {
            const res = await fetch('./api/manage_companies.php', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: company.id, name })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not rename the company.');
            setCompanies(current => current.map(c => (c.id === company.id ? { ...c, name } : c)));
        } catch (err) {
            setError(err.message);
            await loadCompanies();
        }
    };

    const handleRemove = async (company) => {
        if (!window.confirm(`Remove ${company.name} from the company list?`)) return;

        setError(null);
        setNotice(null);
        try {
            const res = await fetch(`./api/manage_companies.php?id=${company.id}`, { method: 'DELETE' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not remove the company.');
            setCompanies(current => current.filter(c => c.id !== company.id));
            setNotice(`${company.name} removed.`);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleSaveWorkedDayHours = async () => {
        setBonusError(null);
        setBonusNotice(null);

        const hours = Number(workedDayHours);
        if (!workedDayHours.trim() || Number.isNaN(hours) || hours <= 0 || hours > 24) {
            setBonusError('Enter a number of hours greater than 0 and no more than 24.');
            return;
        }

        setBonusSaving(true);
        try {
            const res = await fetch('./api/manage_hr_settings.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bonus_worked_day_hours: hours })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not save the setting.');

            const saved = String(json.bonus_worked_day_hours);
            setWorkedDayHours(saved);
            setSavedWorkedDayHours(saved);
            setBonusNotice(`A day now counts once DeskTime records ${saved} hours or more.`);
        } catch (err) {
            setBonusError(err.message);
        } finally {
            setBonusSaving(false);
        }
    };

    /**
     * Forgets the column widths the Bonus list remembers. It lives here rather than on that
     * screen because it is a per-browser preference like the rest of this page, and because
     * a layout dragged into uselessness is hardest to undo from inside itself.
     */
    const handleResetBonusColumns = () => {
        saveColumnWidths(BONUS_COLUMN_WIDTHS_KEY, null);
        setLayoutCleared(true);
    };

    return (
        <div className="schedule-board-container">
            <header className="board-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1>HR</h1>
                        <span className="badge">Settings</span>
                    </div>
                    <div className="week-range-label">
                        Companies, and the settings the HR module runs on.
                    </div>
                </div>
            </header>

            <div className="forecast-settings-scroll">
                <section className="forecast-settings-section">
                    <h2>Company</h2>
                    <p className="section-desc">
                        Add the companies employees can be assigned to. Everything that asks for a company
                        picks from this list, so a name entered here is the one spelling it will have
                        everywhere. Renaming one updates it wherever it is already in use.
                    </p>

                    <div className="company-add-row">
                        <input
                            type="text"
                            className="company-input company-add-input"
                            placeholder="Company name"
                            value={draftName}
                            onChange={(e) => { setDraftName(e.target.value); setError(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                            disabled={saving}
                        />
                        <button className="company-add-btn" onClick={handleAdd} disabled={saving}>
                            {saving ? 'Adding…' : '+ Add Company'}
                        </button>
                    </div>

                    {error && <div className="company-banner is-error">{error}</div>}
                    {notice && <div className="company-banner is-info">{notice}</div>}

                    {loading ? (
                        <p className="section-desc">Loading companies…</p>
                    ) : companies.length === 0 ? (
                        <div className="company-empty">
                            No companies yet. Add the first one above.
                        </div>
                    ) : (
                        <ul className="company-list">
                            {companies.map(company => (
                                <li className="company-row" key={company.id}>
                                    <CompanyNameCell
                                        company={company}
                                        onCommit={(name) => handleRename(company, name)}
                                    />
                                    <button
                                        className="company-remove"
                                        onClick={() => handleRemove(company)}
                                        title={`Remove ${company.name}`}
                                    >
                                        ×
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="forecast-settings-section">
                    <h2>Bonus</h2>
                    <p className="section-desc">
                        Settings the Bonus list reads. They apply to every month, past ones included —
                        Days Employee Worked is recalculated on each load, never stored.
                    </p>

                    <div className="hr-setting">
                        <label className="hr-setting-label" htmlFor="worked-day-hours">
                            A day counts as worked from
                        </label>
                        <div className="hr-setting-control">
                            <input
                                id="worked-day-hours"
                                type="text"
                                inputMode="decimal"
                                className="company-input hr-hours-input"
                                value={workedDayHours}
                                onChange={(e) => {
                                    setWorkedDayHours(e.target.value.replace(/[^\d.]/g, ''));
                                    setBonusError(null);
                                    setBonusNotice(null);
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveWorkedDayHours(); }}
                            />
                            <span className="hr-setting-unit">hours of DeskTime</span>
                            <button
                                className="company-add-btn"
                                onClick={handleSaveWorkedDayHours}
                                disabled={bonusSaving || workedDayHours === savedWorkedDayHours}
                            >
                                {bonusSaving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                        <span className="hr-setting-hint">
                            This number counts. At 7, a day with exactly 7 hours of DeskTime is a worked
                            day. The employee&apos;s shift no longer affects the bar — it is the same for
                            everyone.
                        </span>
                    </div>

                    {bonusError && <div className="company-banner is-error">{bonusError}</div>}
                    {bonusNotice && <div className="company-banner is-info">{bonusNotice}</div>}

                    <div className="hr-setting">
                        <span className="hr-setting-label">Bonus list column widths</span>
                        <div className="hr-setting-control">
                            <button className="company-reset-btn" onClick={handleResetBonusColumns}>
                                ↔ Reset columns
                            </button>
                            {layoutCleared && (
                                <span className="hr-setting-done">
                                    Cleared — the Bonus list opens on its default widths next time.
                                </span>
                            )}
                        </div>
                        <span className="hr-setting-hint">
                            Puts every column of HR &gt; Bonus back to its default width, undoing whatever
                            was dragged there. Stored per browser, so this only affects this one.
                        </span>
                    </div>
                </section>

                {/* The approval workflow's two halves: the message that goes out when a
                    month is signed off, and the lock on a month that has been. */}
                <BonusApprovalEmailSettings />
                <BonusPeriodSettings />
            </div>
        </div>
    );
};

/**
 * The name, editable in place. Commits on blur and on Enter, reverts on Escape — the same
 * contract the Bonus list's cells use, so an editable row behaves the same wherever one
 * turns up in this app.
 */
const CompanyNameCell = ({ company, onCommit }) => {
    const [draft, setDraft] = useState(company.name);
    const [lastName, setLastName] = useState(company.name);

    // Re-seeds the box when the row's own name moves under it (a reload, a rejected rename).
    // Adjusted during render rather than in an effect so it never paints the stale value.
    if (company.name !== lastName) {
        setLastName(company.name);
        setDraft(company.name);
    }

    return (
        <input
            type="text"
            className="company-input company-name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onCommit(draft)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setDraft(company.name); e.currentTarget.blur(); }
            }}
        />
    );
};

export default HRSettings;
