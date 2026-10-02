import React, { useEffect, useMemo, useRef, useState } from 'react';
import './BonusModal.css';
import './AddBonusEmployeeModal.css';
import { normalizeForSearch } from '../utils/search';
import BonusCurrencySelect from './BonusCurrencySelect';
import { DEFAULT_CURRENCY, currencyClass, currencyOf, sanitizeAmountInput } from '../utils/currency';

/**
 * "+ Add Employee" for HR > Bonus.
 *
 * The Employee Name box searches the DeskTime roster, and picking somebody from it fills
 * Team in and locks it: the two came from the same record, so letting them drift apart here
 * would only produce rows whose team disagrees with the platform's own. Anyone DeskTime has
 * never heard of is still addable — the last row of the suggestion list offers the typed
 * text as a manual entry, which unlocks Team for typing because there is no longer a record
 * to read it from.
 *
 * One person can only be on a month's list once, and the modal enforces that by omission
 * rather than by complaint: anyone already enrolled is simply not among the suggestions, and
 * typing their name offers no manual escape hatch either. (manage_bonus.php checks it again
 * server-side — this is the courtesy, not the guarantee.)
 *
 * `roster` is [{ id, name, team }], deduplicated and loaded once by the parent view. The
 * parent mounts this only while the modal is open, so the form starts empty every time
 * without a reset step — the previous employee's name and amount still sitting in the boxes
 * is how a bonus gets entered twice.
 */
const AddBonusEmployeeModal = ({
    roster = [],
    companies = [],
    enrolledEmployeeIds = new Set(),
    enrolledNames = new Set(),
    onClose,
    onConfirm,
    periodLabel
}) => {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(null);   // a roster entry, when one was picked
    const [isManual, setIsManual] = useState(false);  // a name typed by hand
    const [teamName, setTeamName] = useState('');
    // '' is "no company" — optional here, exactly as the column is in the list.
    const [companyId, setCompanyId] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const searchWrapperRef = useRef(null);
    const nameInputRef = useRef(null);

    useEffect(() => {
        if (!showSuggestions) return undefined;
        const onClickAway = (e) => {
            if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', onClickAway);
        return () => document.removeEventListener('mousedown', onClickAway);
    }, [showSuggestions]);

    const suggestions = useMemo(() => {
        // Word by word, not one contiguous string. DeskTime holds people under their full
        // legal name, so "nicolas lauria" has to find "Nicolás Andrés Lauría" — a substring
        // match wants the two words adjacent and in that order, finds nothing, and the
        // person gets typed in by hand as a manual row that has lost its DeskTime link.
        // Every word must land somewhere in name-or-team, none of them in any fixed place.
        const tokens = normalizeForSearch(query).split(/\s+/).filter(Boolean);
        const available = roster.filter(emp => !enrolledEmployeeIds.has(emp.id));
        const matches = tokens.length === 0
            ? available
            : available.filter(emp => {
                const haystack = `${normalizeForSearch(emp.name)} ${normalizeForSearch(emp.team)}`;
                return tokens.every(token => haystack.includes(token));
            });
        // Capped: the roster runs to several hundred names and the list scrolls inside the
        // modal, so past the first page the extra rows only cost render time.
        return matches.slice(0, 50);
    }, [roster, query, enrolledEmployeeIds]);

    const activeCurrency = currencyOf(currency);
    const trimmedQuery = query.trim();
    const isAlreadyEnrolled = trimmedQuery !== ''
        && enrolledNames.has(normalizeForSearch(trimmedQuery));
    // Worth offering only for a name that is neither in the roster (pick it instead) nor
    // already on this month's list (there is nothing to add).
    const canAddManually = trimmedQuery !== '' && !isAlreadyEnrolled &&
        !roster.some(emp => normalizeForSearch(emp.name) === normalizeForSearch(trimmedQuery));

    const handleQueryChange = (value) => {
        setQuery(value);
        setShowSuggestions(true);
        setError(null);
        // Editing the name after a pick breaks the link to that record; Team goes back to
        // being whatever the next choice says it is.
        if (selected) {
            setSelected(null);
            setTeamName('');
        }
        if (isManual) setIsManual(false);
    };

    const handlePickEmployee = (employee) => {
        setSelected(employee);
        setIsManual(false);
        setQuery(employee.name);
        setTeamName(employee.team || '');
        setShowSuggestions(false);
        setError(null);
    };

    const handlePickManual = () => {
        setSelected(null);
        setIsManual(true);
        setQuery(trimmedQuery);
        setTeamName('');
        setShowSuggestions(false);
        setError(null);
    };

    const handleSubmit = async () => {
        const name = trimmedQuery;
        if (!name) {
            setError('Choose an employee, or type a name and add it manually.');
            return;
        }
        if (isAlreadyEnrolled) {
            setError(`${name} is already on the ${periodLabel || 'selected month'} bonus list. Each employee can only appear once, even across teams.`);
            return;
        }
        if (!selected && !isManual) {
            setError(`"${name}" is not on the DeskTime roster. Pick a suggestion, or add the name manually.`);
            return;
        }
        const parsedAmount = Number(amount);
        if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
            setError('Enter a bonus amount greater than zero.');
            return;
        }
        if (isManual && teamName.trim() === '') {
            setError('Enter a team for a manually added employee.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await onConfirm({
                employee_id: selected ? selected.id : null,
                employee_name: name,
                team_name: teamName.trim(),
                company_id: companyId === '' ? null : Number(companyId),
                bonus_amount: parsedAmount,
                currency
            });
        } catch (err) {
            setError(err.message || 'Could not add the employee.');
            setSaving(false);
        }
    };

    /**
     * Enter is Ok — the whole modal is four fields and a button, and reaching for the mouse
     * to finish is the slowest part of adding thirty people.
     *
     * Two things get to answer Enter first. A focused button already turns Enter into its
     * own click (Cancel, a suggestion, the currency picker), so those are left alone rather
     * than fired twice. And in the name box the open dropdown is still the question being
     * asked: a half-typed name with one match resolves to that person, and it is the NEXT
     * Enter that adds the row. Two or more matches fall through to Ok, whose own validation
     * says to pick one — guessing which of fifty names was meant is how the wrong employee
     * gets a bonus.
     */
    const handleKeyDown = (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return;
        if (event.target.closest('button')) return;

        event.preventDefault();
        if (saving) return;

        const inNameBox = event.target === nameInputRef.current;
        if (inNameBox && showSuggestions && !selected && !isManual) {
            // One match wins over the "add manually" row below it: that row is the escape
            // hatch for names DeskTime does not have, and this one it does.
            if (suggestions.length === 1) {
                handlePickEmployee(suggestions[0]);
                return;
            }
            if (suggestions.length === 0 && canAddManually) {
                handlePickManual();
                return;
            }
        }
        handleSubmit();
    };

    return (
        <div className="bonus-modal-overlay" onClick={onClose}>
            <div
                className="bonus-modal-panel bonus-employee-modal"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <div className="bonus-modal-header">
                    <h2>Add Employee</h2>
                    <button className="bonus-modal-close" onClick={onClose}>&times;</button>
                </div>

                <p className="bonus-modal-intro">
                    {periodLabel
                        ? `The employee is added to the ${periodLabel} bonus list.`
                        : 'The employee is added to the selected month\'s bonus list.'}
                </p>

                <div className="bonus-form-group" ref={searchWrapperRef}>
                    <label>Employee Name</label>
                    <div className="bonus-search-wrapper">
                        <input
                            ref={nameInputRef}
                            type="text"
                            className="bonus-input"
                            placeholder="Search DeskTime employees…"
                            value={query}
                            onChange={(e) => handleQueryChange(e.target.value)}
                            onFocus={() => setShowSuggestions(true)}
                            autoFocus
                        />
                        {selected && <span className="bonus-source-chip is-linked">DeskTime</span>}
                        {isManual && <span className="bonus-source-chip is-manual">Manual</span>}

                        {showSuggestions && (
                            <div className="bonus-suggestions">
                                {suggestions.map(emp => (
                                    <button
                                        key={emp.id}
                                        type="button"
                                        className="bonus-suggestion"
                                        onClick={() => handlePickEmployee(emp)}
                                    >
                                        <span className="bonus-suggestion-name">{emp.name}</span>
                                        <span className="bonus-suggestion-team">{emp.team || 'No team'}</span>
                                    </button>
                                ))}
                                {suggestions.length === 0 && !isAlreadyEnrolled && (
                                    <div className="bonus-suggestions-empty">
                                        No DeskTime employee matches that name.
                                    </div>
                                )}
                                {isAlreadyEnrolled && (
                                    <div className="bonus-suggestions-empty is-blocked">
                                        “{trimmedQuery}” is already on the {periodLabel} list.
                                    </div>
                                )}
                                {canAddManually && (
                                    <button
                                        type="button"
                                        className="bonus-suggestion bonus-suggestion-manual"
                                        onClick={handlePickManual}
                                    >
                                        <span className="bonus-suggestion-name">➕ Add “{trimmedQuery}” manually</span>
                                        <span className="bonus-suggestion-team">Not in DeskTime</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="bonus-form-group">
                    <label>Team</label>
                    <input
                        type="text"
                        className="bonus-input"
                        placeholder={isManual ? 'Type the team name' : 'Filled in from the employee'}
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        readOnly={!isManual}
                        disabled={!isManual && !selected}
                    />
                    {selected && (
                        <span className="bonus-field-hint">Linked to DeskTime — the team follows the employee's record.</span>
                    )}
                </div>

                <div className="bonus-form-group">
                    <label>Company</label>
                    {/* A plain <select>: a closed list with nothing to search and nothing to
                        colour, unlike the currency picker below it. Optional, and editable
                        in the list afterwards either way. */}
                    <select
                        className="bonus-input bonus-select-field"
                        value={companyId}
                        onChange={(e) => setCompanyId(e.target.value)}
                        disabled={companies.length === 0}
                    >
                        <option value="">— No company —</option>
                        {companies.map(company => (
                            <option key={company.id} value={company.id}>{company.name}</option>
                        ))}
                    </select>
                    {companies.length === 0 && (
                        <span className="bonus-field-hint">
                            No companies yet — add them in Configuration &gt; HR &gt; Company.
                        </span>
                    )}
                </div>

                <div className="bonus-form-group">
                    <label>Bonus Amount</label>
                    <div className="bonus-amount-row">
                        <div className="bonus-amount-field">
                            <span className={`bonus-amount-symbol ${currencyClass(activeCurrency.code)}`}>
                                {activeCurrency.symbol}
                            </span>
                            <input
                                type="text"
                                inputMode="decimal"
                                className="bonus-input bonus-amount-input"
                                placeholder="0.00"
                                value={amount}
                                onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
                            />
                        </div>

                        <BonusCurrencySelect value={currency} onChange={setCurrency} />
                    </div>
                </div>

                {error && <div className="bonus-modal-error">{error}</div>}

                <div className="bonus-modal-footer">
                    <button className="bonus-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
                    <button className="bonus-btn-confirm" onClick={handleSubmit} disabled={saving}>
                        {saving ? 'Adding…' : 'Ok'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddBonusEmployeeModal;
