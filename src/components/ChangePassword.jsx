import React, { useState } from 'react';
import './ChangePassword.css';

const ChangePassword = ({ user }) => {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState(null);
    const [status, setStatus] = useState(null); // null | 'saving' | 'saved'

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setStatus(null);

        if (newPassword.length < 6) {
            setError('New password must be at least 6 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('New password and confirmation do not match.');
            return;
        }

        setStatus('saving');
        try {
            const res = await fetch('./api/change_password.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
            });
            const json = await res.json();
            if (json.success) {
                setStatus('saved');
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
            } else {
                setStatus(null);
                setError(json.error || 'Failed to change password.');
            }
        } catch (err) {
            setStatus(null);
            setError('Failed to change password.');
        }
    };

    return (
        <div className="change-password-container">
            <header className="change-password-header">
                <h1>Password</h1>
                <p>
                    Change the password for your account
                    {user?.username ? <> (<strong>{user.username}</strong>)</> : null}.
                </p>
            </header>

            <form className="change-password-card" onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>Current Password</label>
                    <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        required
                    />
                </div>

                <div className="form-group">
                    <label>New Password</label>
                    <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        autoComplete="new-password"
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Confirm New Password</label>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        required
                    />
                </div>

                {error && <p className="change-password-error">{error}</p>}
                {status === 'saved' && <p className="change-password-success">Password updated.</p>}

                <button type="submit" className="change-password-btn" disabled={status === 'saving'}>
                    {status === 'saving' ? 'Saving...' : 'Update Password'}
                </button>
            </form>
        </div>
    );
};

export default ChangePassword;
