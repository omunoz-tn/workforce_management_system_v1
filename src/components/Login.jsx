import React, { useState } from 'react';
import './Login.css';
import appLogo from '../assets/logo.png';

const Login = ({ onLoginSuccess }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const response = await fetch('./api/auth.php?action=login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                onLoginSuccess(data.user);
            } else if (typeof data.success === 'undefined') {
                // Not a normal auth.php response (e.g. db_wfm_config.php failed to reach
                // the database before auth.php's own logic ever ran) — don't imply the
                // password was wrong when the real problem is the backend/database.
                setError('Unable to reach the server right now. Please try again shortly or contact IT support.');
            } else {
                setError(data.message || 'Invalid credentials');
            }
        } catch (err) {
            setError('Connection failed. Please check your backend.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-page">

            
            <div className="login-card">
                <div className="login-header">
                    <img src={appLogo} alt="Logo" className="login-logo" />
                    <h1>Telecom Networks Workforce Platform</h1>
                    <p>Welcome back! Please enter your details.</p>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label>Username</label>
                        <input 
                            type="text" 
                            placeholder="Enter your username" 
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <input 
                            type="password" 
                            placeholder="••••••••" 
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {error && <div className="login-error">{error}</div>}

                    <button type="submit" className="login-btn" disabled={isLoading}>
                        {isLoading ? <span className="spinner"></span> : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;
