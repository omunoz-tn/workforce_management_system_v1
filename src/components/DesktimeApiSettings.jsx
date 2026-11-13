import React, { useEffect, useState } from 'react';
import './ScheduleBoard.css';
import './ScheduleForecastSettings.css';
import './DesktimeApiSettings.css';

/**
 * Configuration > Desktime API.
 *
 * The DeskTime API keys FOCUS syncs with, in the same `DESKTIME_API_KEY_<ACCOUNT>=<key>`
 * lines the .env uses, one account per line, in a box that is free to edit. Once saved they
 * replace the .env's keys on the next request (manage_desktime_api.php / DesktimeApiKeys.php),
 * so rotating a key is an edit here rather than a file change on the server. "Test keys" asks
 * DeskTime about each line without saving, because a rejected key otherwise only shows up as
 * a sync that quietly brought nothing back.
 */
const DesktimeApiSettings = () => {
    const [text, setText] = useState('');
    const [savedText, setSavedText] = useState('');
    const [envText, setEnvText] = useState('');
    const [source, setSource] = useState(null);
    const [updatedAt, setUpdatedAt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [testResults, setTestResults] = useState(null);

    const applyResponse = (json) => {
        setText(json.text || '');
        setSavedText(json.text || '');
        setSource(json.source);
        setUpdatedAt(json.updated_at || null);
        if (json.env_text !== undefined) setEnvText(json.env_text);
    };

    useEffect(() => {
        fetch('./api/manage_desktime_api.php')
            .then(res => res.json())
            .then(json => {
                if (!json.success) throw new Error(json.error || 'Could not load the DeskTime API keys.');
                applyResponse(json);
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    const post = async (body) => {
        const res = await fetch('./api/manage_desktime_api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'The request failed.');
        return json;
    };

    const handleSave = async () => {
        if (text.trim() === '' && !window.confirm('The box is empty. Saving it removes the keys from the configuration and FOCUS goes back to the keys in the .env file. Continue?')) {
            return;
        }
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            const json = await post({ text });
            applyResponse(json);
            setNotice(json.source === 'configuration'
                ? `Saved. FOCUS now syncs with ${json.accounts.length} DeskTime account${json.accounts.length === 1 ? '' : 's'} (${json.accounts.join(', ')}).`
                : 'Configuration cleared. FOCUS is using the keys from the .env file again.');
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        setError(null);
        setTestResults(null);
        try {
            const json = await post({ action: 'test', text });
            setTestResults(json.results || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setTesting(false);
        }
    };

    const dirty = text !== savedText;
    const lineCount = Math.max(4, text.split('\n').length + 1);

    return (
        <div className="schedule-board-container">
            <header className="board-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1>Desktime API</h1>
                        <span className="badge">Settings</span>
                    </div>
                    <div className="week-range-label">
                        The DeskTime API keys FOCUS uses to sync hours and projects.
                    </div>
                </div>
            </header>

            <div className="forecast-settings-scroll">
                <section className="forecast-settings-section">
                    <h2>API keys</h2>
                    <p className="section-desc">
                        One account per line, written as in the .env file: <code>DESKTIME_API_KEY_&lt;ACCOUNT&gt;=&lt;key&gt;</code>.
                        The keys saved here are the ones every sync uses, instead of the .env's. To change a key, edit its
                        line and save; to add an account, add a line. Lines starting with <code>#</code> are ignored.
                    </p>

                    {!loading && (
                        <div className={`dtapi-source${source === 'configuration' ? ' is-config' : ''}`}>
                            {source === 'configuration'
                                ? `In use: keys from this configuration${updatedAt ? ` (last saved ${updatedAt})` : ''}.`
                                : 'In use: keys from the .env file. Save to have FOCUS use the keys from this configuration.'}
                        </div>
                    )}

                    {loading ? (
                        <p className="section-desc">Loading…</p>
                    ) : (
                        <>
                            <textarea
                                className="dtapi-textarea"
                                value={text}
                                rows={lineCount}
                                spellCheck={false}
                                autoComplete="off"
                                placeholder={'DESKTIME_API_KEY_TN=...\nDESKTIME_API_KEY_BAY=...'}
                                onChange={(e) => { setText(e.target.value); setNotice(null); setTestResults(null); }}
                                disabled={saving}
                            />

                            <div className="dtapi-actions">
                                <button className="dtapi-btn is-primary" onClick={handleSave} disabled={saving || !dirty}>
                                    {saving ? 'Saving…' : 'Save'}
                                </button>
                                <button className="dtapi-btn" onClick={handleTest} disabled={testing || saving || text.trim() === ''}>
                                    {testing ? 'Testing…' : 'Test keys'}
                                </button>
                                <button className="dtapi-btn" onClick={() => { setText(savedText); setError(null); setTestResults(null); }} disabled={saving || !dirty}>
                                    Discard changes
                                </button>
                                {envText && text !== envText && (
                                    <button
                                        className="dtapi-btn is-link"
                                        onClick={() => { setText(envText); setNotice(null); setTestResults(null); }}
                                        disabled={saving}
                                        title="Put the keys from the .env file in the box (not saved until you press Save)"
                                    >
                                        Load keys from .env
                                    </button>
                                )}
                                {dirty && <span className="dtapi-dirty">Unsaved changes</span>}
                            </div>

                            {error && <div className="dtapi-banner is-error">{error}</div>}
                            {notice && <div className="dtapi-banner is-info">{notice}</div>}

                            {testResults && (
                                <ul className="dtapi-results">
                                    {testResults.map(r => (
                                        <li key={r.account} className={r.ok ? 'is-ok' : 'is-bad'}>
                                            <strong>{r.account}</strong>
                                            <span>{r.ok ? `Accepted${r.company ? ` — ${r.company}` : ''}` : `Rejected: ${r.error}`}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </section>
            </div>
        </div>
    );
};

export default DesktimeApiSettings;
