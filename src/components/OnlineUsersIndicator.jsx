import { useRef, useState } from 'react';
import './OnlineUsersIndicator.css';

// Sidebar status dot. Its colour is the backend status (green = connected). For admins,
// hovering it lists the platform users online right now (user_presence.php); everyone
// else keeps the plain backend-status title.
const formatAgo = (seconds) => {
    if (seconds < 60) return 'active now';
    const minutes = Math.round(seconds / 60);
    return `active ${minutes} min ago`;
};

const OnlineUsersIndicator = ({ backendStatus, isAdmin, style }) => {
    const dotRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const [users, setUsers] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const connected = backendStatus === 'Connected';

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('./api/user_presence.php');
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not load online users.');
            setUsers(json.users || []);
        } catch (err) {
            setError(err.message || 'Could not load online users.');
        } finally {
            setLoading(false);
        }
    };

    const show = () => {
        if (!isAdmin) return;
        const rect = dotRef.current?.getBoundingClientRect();
        // Fixed so the sidebar's overflow cannot clip it; kept inside the viewport.
        if (rect) setPos({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left - 12, window.innerWidth - 268)) });
        setOpen(true);
        load(); // refresh on every hover: the list is only useful when current
    };

    return (
        <>
            <div
                ref={dotRef}
                className={`backend-indicator${isAdmin ? ' online-users-trigger' : ''}`}
                title={isAdmin ? undefined : backendStatus}
                style={{ background: connected ? '#10b981' : '#f59e0b', ...style }}
                onMouseEnter={show}
                onMouseLeave={() => setOpen(false)}
            />
            {open && (
                <div className="online-users-tooltip" style={{ top: pos.top, left: pos.left }} role="tooltip">
                    <div className="online-users-head">
                        <span className={`online-users-status${connected ? ' is-ok' : ''}`}>{backendStatus}</span>
                        <span className="online-users-count">
                            {users ? `${users.length} online` : ''}
                        </span>
                    </div>
                    {error ? (
                        <div className="online-users-empty">{error}</div>
                    ) : users === null && loading ? (
                        <div className="online-users-empty">Loading…</div>
                    ) : users && users.length === 0 ? (
                        <div className="online-users-empty">Nobody online</div>
                    ) : (
                        <ul className="online-users-list">
                            {(users || []).map(u => (
                                <li key={u.id}>
                                    <span className="online-users-dot" />
                                    <span className="online-users-name">
                                        {u.full_name || u.username}
                                        <span className="online-users-meta">
                                            {u.role ? `${u.role} · ` : ''}{formatAgo(u.seconds_ago)}
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </>
    );
};

export default OnlineUsersIndicator;
