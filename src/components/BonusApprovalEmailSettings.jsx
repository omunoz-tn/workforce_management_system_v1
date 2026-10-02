import React, { useEffect, useRef, useState } from 'react';
import './BonusApprovalEmailSettings.css';

/**
 * Configuration > HR > Bonus Approval Email.
 *
 * The notification Finance receives when a bonus month is approved, as editable data:
 * recipients, a subject line and a body. Nothing about this message is written in code —
 * the server holds a default and uses it only until somebody saves something, and after
 * that the saved version is what is sent, forever. That is why there is a "Reset to
 * default" and no other path back.
 *
 * The body editor is a contentEditable div driven by document.execCommand. Deprecated, and
 * chosen anyway: the project has no rich-text dependency, adding one for bold/italic/lists
 * would be the largest thing in the bundle, and execCommand is still what every browser
 * implements. What it produces is plain <p>/<strong>/<ul> markup, which is also the only
 * thing an email client can be relied on to render — a modern editor's <div contenteditable>
 * output would need converting back to that anyway.
 *
 * The editor is UNCONTROLLED on purpose. Writing React state back into a contentEditable on
 * every keystroke moves the caret to the end of the document, which makes it impossible to
 * edit the middle of a sentence. So the DOM holds the draft, `dirty` tracks whether it
 * differs from what was loaded, and the value is read out only when saving or previewing.
 */

const VARIABLE_HINTS = {
    'Bonus Name': 'Bonus Home Office / Transportation',
    Month: 'August',
    Year: '2026',
    Period: 'August 2026',
    'Total Employees': '179',
    'Total USD': 'US$ 965.48',
    'Total DOP': 'RD$ 475,904.76',
    'Approved By': 'the approver',
    'Approval Date': 'the moment of approval'
};

const BonusApprovalEmailSettings = () => {
    const [config, setConfig] = useState(null);
    const [variables, setVariables] = useState([]);
    const [transportConfigured, setTransportConfigured] = useState(true);
    const [loading, setLoading] = useState(true);

    const [recipients, setRecipients] = useState([]);
    const [draftEmail, setDraftEmail] = useState('');
    const [subject, setSubject] = useState('');
    const [dirty, setDirty] = useState(false);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [preview, setPreview] = useState(null);
    const [variableMenuOpen, setVariableMenuOpen] = useState(false);

    const bodyRef = useRef(null);
    const variableMenuRef = useRef(null);
    // The last place the caret was inside the body, so a variable picked from the menu lands
    // where the user was typing. Clicking the menu moves focus out of the editor and the
    // live selection is gone by the time the choice is made.
    const savedRange = useRef(null);

    const load = async () => {
        try {
            const res = await fetch('./api/manage_bonus_email.php');
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not load the email configuration.');
            setConfig(json.config);
            setVariables(json.variables || []);
            setTransportConfigured(json.transport_configured !== false);
            setRecipients(json.config.recipients || []);
            setSubject(json.config.subject || '');
            if (bodyRef.current) bodyRef.current.innerHTML = json.config.body || '';
            setDirty(false);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    useEffect(() => {
        if (!variableMenuOpen) return undefined;
        const onClickAway = (e) => {
            if (!variableMenuRef.current?.contains(e.target)) setVariableMenuOpen(false);
        };
        document.addEventListener('mousedown', onClickAway);
        return () => document.removeEventListener('mousedown', onClickAway);
    }, [variableMenuOpen]);

    /* ── Recipients ─────────────────────────────────────────────────────── */

    const handleAddEmail = () => {
        const address = draftEmail.trim();
        setError(null);
        setNotice(null);

        if (address === '') return;
        // Checked here for an immediate answer and again on the server, which is the one
        // that decides — this box is not the only way a recipient can arrive.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
            setError(`"${address}" is not a valid email address.`);
            return;
        }
        if (recipients.some(existing => existing.toLowerCase() === address.toLowerCase())) {
            setError(`"${address}" is already on the list.`);
            return;
        }

        setRecipients([...recipients, address]);
        setDraftEmail('');
        setDirty(true);
    };

    const handleRemoveEmail = (address) => {
        setRecipients(recipients.filter(existing => existing !== address));
        setDirty(true);
        setNotice(null);
    };

    /* ── Body editor ────────────────────────────────────────────────────── */

    const rememberCaret = () => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && bodyRef.current?.contains(selection.anchorNode)) {
            savedRange.current = selection.getRangeAt(0).cloneRange();
        }
    };

    const format = (command) => {
        bodyRef.current?.focus();
        // Restore the caret first: clicking a toolbar button blurs the editor, and without
        // this the command applies to nothing.
        if (savedRange.current) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(savedRange.current);
        }
        document.execCommand(command, false, null);
        rememberCaret();
        setDirty(true);
    };

    const insertVariable = (name) => {
        setVariableMenuOpen(false);
        bodyRef.current?.focus();
        if (savedRange.current) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(savedRange.current);
        }
        document.execCommand('insertText', false, `[${name}]`);
        rememberCaret();
        setDirty(true);
    };

    /* ── Save / preview / reset ─────────────────────────────────────────── */

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            const res = await fetch('./api/manage_bonus_email.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipients,
                    subject,
                    body: bodyRef.current?.innerHTML ?? ''
                })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not save the configuration.');

            setConfig(json.config);
            setRecipients(json.config.recipients || []);
            setSubject(json.config.subject || '');
            if (bodyRef.current) bodyRef.current.innerHTML = json.config.body || '';
            setDirty(false);
            setNotice('Saved. This is the message sent the next time a bonus period is approved.');
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handlePreview = async () => {
        setError(null);
        setNotice(null);
        try {
            const today = new Date();
            // Last month, the same one HR > Bonus opens on, so the figures are a real list.
            const period = new Date(today.getFullYear(), today.getMonth(), 0);
            const res = await fetch('./api/manage_bonus_email.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'preview',
                    year: period.getFullYear(),
                    month: period.getMonth() + 1,
                    subject,
                    body: bodyRef.current?.innerHTML ?? ''
                })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not build the preview.');
            setPreview(json.preview);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleReset = async () => {
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            const res = await fetch('./api/manage_bonus_email.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reset', target: 'all' })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not reset the template.');

            setConfig(json.config);
            setSubject(json.config.subject || '');
            if (bodyRef.current) bodyRef.current.innerHTML = json.config.body || '';
            setDirty(false);
            setNotice('Subject and body are back to the default template.');
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <section className="forecast-settings-section">
                <h2>Bonus Approval Email</h2>
                <p className="section-desc">Loading…</p>
            </section>
        );
    }

    const isCustom = config?.is_custom_subject || config?.is_custom_body;

    return (
        <section className="forecast-settings-section">
            <h2>Bonus Approval Email</h2>
            <p className="section-desc">
                The notification sent to Finance when a bonus period is approved. Recipients, subject
                and body are all editable — once saved, your version is the one that is sent, and
                nothing replaces it unless you reset it here.
            </p>

            {!transportConfigured && (
                <div className="bonus-email-banner is-warning">
                    No mail transport is configured on this server. Set <code>SMTP_HOST</code> in
                    <code>.env</code>, or approvals will complete and report that the notification
                    could not be sent.
                </div>
            )}

            {error && <div className="bonus-email-banner is-error">{error}</div>}
            {notice && <div className="bonus-email-banner is-ok">{notice}</div>}

            {/* ── Recipients ─────────────────────────────────────────────── */}
            <h3 className="bonus-email-subhead">Recipients</h3>
            {recipients.length === 0 ? (
                <p className="bonus-email-empty">
                    No recipients yet. An approval will still complete without them — it will just say
                    that nobody was notified.
                </p>
            ) : (
                <ul className="bonus-email-recipients">
                    {recipients.map(address => (
                        <li key={address}>
                            <span className="bonus-email-address">{address}</span>
                            <button
                                type="button"
                                className="bonus-email-remove"
                                onClick={() => handleRemoveEmail(address)}
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="bonus-email-add-row">
                <input
                    type="email"
                    className="company-input company-add-input"
                    placeholder="name@company.com"
                    value={draftEmail}
                    onChange={(e) => { setDraftEmail(e.target.value); setError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddEmail(); } }}
                />
                <button className="company-add-btn" onClick={handleAddEmail}>+ Add Email</button>
            </div>

            {/* ── Subject ────────────────────────────────────────────────── */}
            <h3 className="bonus-email-subhead">Email Subject</h3>
            <input
                type="text"
                className="company-input bonus-email-subject"
                value={subject}
                onChange={(e) => { setSubject(e.target.value); setDirty(true); }}
                maxLength={255}
            />

            {/* ── Body ───────────────────────────────────────────────────── */}
            <h3 className="bonus-email-subhead">Email Body</h3>
            <div className="bonus-email-toolbar">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => format('bold')} title="Bold">
                    <strong>B</strong>
                </button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => format('italic')} title="Italic">
                    <em>I</em>
                </button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => format('underline')} title="Underline">
                    <span style={{ textDecoration: 'underline' }}>U</span>
                </button>
                <span className="bonus-email-toolbar-sep" />
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => format('insertUnorderedList')} title="Bulleted list">
                    • List
                </button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => format('insertOrderedList')} title="Numbered list">
                    1. List
                </button>

                <div className="bonus-email-variable-menu" ref={variableMenuRef}>
                    <button
                        type="button"
                        className="bonus-email-variable-trigger"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setVariableMenuOpen(open => !open)}
                        aria-expanded={variableMenuOpen}
                    >
                        Insert Variable ▾
                    </button>
                    {variableMenuOpen && (
                        <div className="bonus-email-variable-list">
                            {variables.map(name => (
                                <button
                                    key={name}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => insertVariable(name)}
                                >
                                    <span className="bonus-email-variable-name">[{name}]</span>
                                    <span className="bonus-email-variable-hint">{VARIABLE_HINTS[name] || ''}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Uncontrolled: see the note at the top of this file. suppressContentEditableWarning
                is React acknowledging that the DOM under this node is not its business. */}
            <div
                ref={bodyRef}
                className="bonus-email-editor"
                contentEditable
                suppressContentEditableWarning
                onInput={() => { rememberCaret(); setDirty(true); }}
                onKeyUp={rememberCaret}
                onMouseUp={rememberCaret}
                onBlur={rememberCaret}
            />

            <p className="bonus-email-variable-note">
                Anything in square brackets from the menu above is replaced when the email is sent.
                Text you type that happens to use brackets is left exactly as written.
            </p>

            <div className="bonus-email-actions">
                <button className="company-add-btn is-secondary" onClick={handlePreview}>
                    Preview Email
                </button>
                <button className="company-add-btn" onClick={handleSave} disabled={saving || !dirty}>
                    {saving ? 'Saving…' : dirty ? 'Save Changes' : 'Saved'}
                </button>
                {isCustom && (
                    <button className="bonus-email-reset" onClick={handleReset} disabled={saving}>
                        Reset to default
                    </button>
                )}
            </div>

            {preview && (
                <div className="bonus-modal-overlay" onClick={() => setPreview(null)}>
                    <div className="bonus-modal-panel bonus-email-preview" onClick={(e) => e.stopPropagation()}>
                        <div className="bonus-modal-header">
                            <div>
                                <h2>Email Preview</h2>
                                <span className="bonus-approval-period">
                                    {preview.is_live_data
                                        ? 'Variables filled in from a real bonus month.'
                                        : 'That month has no bonus list yet — the figures show as zero.'}
                                </span>
                            </div>
                            <button className="bonus-modal-close" onClick={() => setPreview(null)}>&times;</button>
                        </div>

                        <div className="bonus-email-preview-field">
                            <span className="bonus-email-preview-label">To</span>
                            <span className="bonus-email-preview-value">
                                {preview.recipients.length > 0
                                    ? preview.recipients.join(', ')
                                    : 'No recipients configured'}
                            </span>
                        </div>
                        <div className="bonus-email-preview-field">
                            <span className="bonus-email-preview-label">Subject</span>
                            <span className="bonus-email-preview-value is-subject">{preview.subject}</span>
                        </div>

                        {/* The body is HTML the server has already stripped to the tags an email
                            client renders — see bonusEmailSanitizeBody(). */}
                        <div
                            className="bonus-email-preview-body"
                            dangerouslySetInnerHTML={{ __html: preview.body }}
                        />

                        <div className="bonus-modal-footer">
                            <button className="bonus-btn-cancel" onClick={() => setPreview(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};

export default BonusApprovalEmailSettings;
