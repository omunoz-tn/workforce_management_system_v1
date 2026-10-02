import React, { useState, useEffect, useMemo, useRef } from 'react';
import './LoginManagement.css';
import { PERMISSION_MODULES } from '../menuConfig';

// Rendered by the Modules tab: every role-gated sub-menu, derived from the
// shared sidebar config so a new sub-menu is togglable without editing this file.
const MODULES = PERMISSION_MODULES;

const LoginManagement = () => {
    const [activeTab, setActiveTab] = useState('users');
    const [users, setUsers] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const usersPerPage = 8;
    const [roles, setRoles] = useState([]);
    const [permissions, setPermissions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showUserModal, setShowUserModal] = useState(false);
    const [showRoleModal, setShowRoleModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    const [selectedRole, setSelectedRole] = useState(null);
    const [roleView, setRoleView] = useState('modules'); // 'modules' or 'teams'
    const [orgTeams, setOrgTeams] = useState([]);
    const [roleTeams, setRoleTeams] = useState([]);

    // Staging changes to prevent "flickering" (auto-save on every toggle)
    const [stagedPermissions, setStagedPermissions] = useState(new Set());
    const [stagedTeams, setStagedTeams] = useState(new Set());
    const [stagedTeamScope, setStagedTeamScope] = useState('selected');
    const [isSavingAccess, setIsSavingAccess] = useState(false);

    // Form states
    const [userForm, setUserForm] = useState({ username: '', password: '', full_name: '', role_id: '', status: 'active' });
    const [roleForm, setRoleForm] = useState({ name: '' });
    const [currentUserId, setCurrentUserId] = useState(null);

    // Default password: applied to every new user and re-applied by "Reset Password"
    const [defaultPassword, setDefaultPassword] = useState('');
    const [defaultPasswordDraft, setDefaultPasswordDraft] = useState('');
    const [showDefaultPassword, setShowDefaultPassword] = useState(false);
    const [isSavingDefaultPassword, setIsSavingDefaultPassword] = useState(false);

    // Set to a freshly duplicated role's id so it gets selected once fetchData lands
    const [pendingRoleSelectId, setPendingRoleSelectId] = useState(null);
    const [isSavingRole, setIsSavingRole] = useState(false);

    // Role ordering. Every move persists on its own; savedRoleOrder is the last
    // sequence the server confirmed, kept only to roll back a failed save.
    const [savedRoleOrder, setSavedRoleOrder] = useState([]);
    const [dragRoleId, setDragRoleId] = useState(null);
    const [dragOverRoleId, setDragOverRoleId] = useState(null);
    const [roleOrderStatus, setRoleOrderStatus] = useState(null); // null | 'saving' | 'saved'

    // Mirrors `roles` synchronously. Held-down arrow keys can fire faster than React
    // re-renders, and each move has to build on the previous one, not on a stale array.
    const rolesRef = useRef([]);
    const roleOrderTimers = useRef({ save: null, flash: null });
    // Saves run one after another. Without this, a slow request carrying an older
    // order could land after a newer one and leave the stored order stale.
    const roleOrderQueue = useRef(Promise.resolve());

    useEffect(() => {
        fetchData();
    }, []);

    // When the selected role changes, initialize staged state from saved data
    useEffect(() => {
        if (selectedRole) {
            const rolePerms = permissions
                .filter(p => p.role_id === selectedRole.id)
                .map(p => p.menu_item_id);
            setStagedPermissions(new Set(rolePerms));

            const roleTms = roleTeams
                .filter(rt => rt.role_id === selectedRole.id)
                .map(rt => rt.team_id);
            setStagedTeams(new Set(roleTms));
            setStagedTeamScope(selectedRole.team_scope === 'all' ? 'all' : 'selected');
        }
    }, [selectedRole, permissions, roleTeams]);
    
    useEffect(() => {
        if (!pendingRoleSelectId) return;
        const created = roles.find(r => String(r.id) === pendingRoleSelectId);
        if (created) {
            setSelectedRole(created);
            setPendingRoleSelectId(null);
        }
    }, [roles, pendingRoleSelectId]);

    useEffect(() => {
        const totalPages = Math.ceil(users.length / usersPerPage);
        if (currentPage > totalPages && totalPages > 0) {
            setCurrentPage(totalPages);
        }
    }, [users.length, currentPage, usersPerPage]);

    const isDirty = useMemo(() => {
        if (!selectedRole) return false;
        
        const currentPermsFiltered = permissions.filter(p => p.role_id === selectedRole.id).map(p => p.menu_item_id);
        const currentTeamsFiltered = roleTeams.filter(rt => rt.role_id === selectedRole.id).map(rt => rt.team_id);
        
        const permsChanged = currentPermsFiltered.length !== stagedPermissions.size || currentPermsFiltered.some(id => !stagedPermissions.has(id));
        const teamsChanged = currentTeamsFiltered.length !== stagedTeams.size || currentTeamsFiltered.some(id => !stagedTeams.has(id));
        const savedScope = selectedRole.team_scope === 'all' ? 'all' : 'selected';
        const scopeChanged = savedScope !== stagedTeamScope;
        
        return permsChanged || teamsChanged || scopeChanged;
    }, [selectedRole, permissions, roleTeams, stagedPermissions, stagedTeams, stagedTeamScope]);

    useEffect(() => {
        rolesRef.current = roles;
    }, [roles]);

    useEffect(() => () => {
        clearTimeout(roleOrderTimers.current.save);
        clearTimeout(roleOrderTimers.current.flash);
    }, []);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('./api/manage_login.php?action=list_all');
            const data = await res.json();
            if (data.success) {
                setUsers(data.users);
                setRoles(data.roles);
                setSavedRoleOrder(data.roles.map(r => String(r.id)));
                setPermissions(data.permissions);
                setRoleTeams(data.role_teams || []);
                setOrgTeams(data.org_teams || []);
                setCurrentUserId(data.current_user_id ?? null);
                setDefaultPassword(data.default_password || '');
                setDefaultPasswordDraft(data.default_password || '');
            }
        } catch (err) {
            console.error("Fetch Error:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveUser = async (e) => {
        e.preventDefault();
        const action = selectedUser ? 'update' : 'create';
        try {
            const res = await fetch('./api/manage_login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    type: 'user', 
                    action, 
                    ...userForm,
                    id: selectedUser?.id 
                })
            });
            const data = await res.json();
            if (data.success) {
                setShowUserModal(false);
                fetchData();
            } else {
                alert(data.error || "Error saving user");
            }
        } catch (err) {
            alert("Error saving user");
        }
    };

    const handleSaveDefaultPassword = async (e) => {
        e.preventDefault();
        setIsSavingDefaultPassword(true);
        try {
            const res = await fetch('./api/manage_login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'setting',
                    action: 'save_default_password',
                    password: defaultPasswordDraft
                })
            });
            const data = await res.json();
            if (data.success) {
                const saved = data.default_password ?? defaultPasswordDraft;
                setDefaultPassword(saved);
                setDefaultPasswordDraft(saved);
                alert("Default password saved. It will be applied to every new user.");
            } else {
                alert(data.error || "Error saving default password");
            }
        } catch (err) {
            alert("Error saving default password");
        } finally {
            setIsSavingDefaultPassword(false);
        }
    };

    const handleTogglePermission = (moduleId) => {
        setStagedPermissions(prev => {
            const next = new Set(prev);
            if (next.has(moduleId)) next.delete(moduleId);
            else next.add(moduleId);
            return next;
        });
    };

    const handleToggleTeamAccess = (teamId) => {
        setStagedTeams(prev => {
            const next = new Set(prev);
            if (next.has(teamId)) next.delete(teamId);
            else next.add(teamId);
            return next;
        });
    };

    const handleSaveAccess = async () => {
        if (!selectedRole) return;
        setIsSavingAccess(true);
        try {
            // Sync Permissions
            await fetch('./api/manage_login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    type: 'permission', 
                    action: 'sync', 
                    role_id: selectedRole.id,
                    permissions: Array.from(stagedPermissions)
                })
            });

            // Sync Teams
            await fetch('./api/manage_login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    type: 'role_team', 
                    action: 'sync', 
                    role_id: selectedRole.id,
                    team_ids: Array.from(stagedTeams)
                })
            });

            // Data scope: 'all' ignores the checkboxes, 'selected' honours them and
            // grants nothing when none are ticked.
            await fetch('./api/manage_login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'role',
                    action: 'set_team_scope',
                    id: selectedRole.id,
                    team_scope: stagedTeamScope
                })
            });

            alert("Permissions and Team Access saved successfully.");
            fetchData(); // Refresh global state
        } catch (err) {
            alert("Error saving access changes");
        } finally {
            setIsSavingAccess(false);
        }
    };

    const handleDiscardChanges = () => {
        if (!selectedRole) return;
        const rolePerms = permissions
            .filter(p => p.role_id === selectedRole.id)
            .map(p => p.menu_item_id);
        setStagedPermissions(new Set(rolePerms));

        const roleTms = roleTeams
            .filter(rt => rt.role_id === selectedRole.id)
            .map(rt => rt.team_id);
        setStagedTeams(new Set(roleTms));
        setStagedTeamScope(selectedRole.team_scope === 'all' ? 'all' : 'selected');
    };

    const handleBulkSelect = (type, mode) => {
        if (type === 'modules') {
            if (mode === 'all') setStagedPermissions(new Set(MODULES.map(m => m.id)));
            else setStagedPermissions(new Set());
        } else {
            if (mode === 'all') setStagedTeams(new Set(orgTeams.map(t => t.id)));
            else setStagedTeams(new Set());
        }
    };

    // Writes the order the list is currently showing. Debounced so that holding an
    // arrow key down produces one request for the final position, not one per step.
    const persistRoleOrder = (orderedRoles) => {
        const roleIds = orderedRoles.map(r => r.id);
        clearTimeout(roleOrderTimers.current.save);
        clearTimeout(roleOrderTimers.current.flash);
        setRoleOrderStatus('saving');

        roleOrderTimers.current.save = setTimeout(() => {
            roleOrderQueue.current = roleOrderQueue.current.then(async () => {
                try {
                    const res = await fetch('./api/manage_login.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'role', action: 'reorder', role_ids: roleIds })
                    });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.error || 'Reorder rejected');

                    // Deliberately no fetchData(): refetching replaces `permissions`, which
                    // would wipe any permission toggles staged in the panel on the right.
                    setSavedRoleOrder(roleIds.map(String));
                    setRoleOrderStatus('saved');
                    roleOrderTimers.current.flash = setTimeout(() => setRoleOrderStatus(null), 1500);
                } catch (err) {
                    // Put the list back where the server still has it, so what is on screen
                    // never disagrees with what is stored.
                    setRoles(prev => {
                        const byId = new Map(prev.map(r => [String(r.id), r]));
                        const restored = savedRoleOrder.map(id => byId.get(id)).filter(Boolean);
                        return restored.length === prev.length ? restored : prev;
                    });
                    setRoleOrderStatus(null);
                    alert("The new role order could not be saved, so the list was put back.");
                }
            });
        }, 400);
    };

    const moveRoleToIndex = (roleId, targetIndex) => {
        const current = rolesRef.current;
        const from = current.findIndex(r => String(r.id) === String(roleId));
        if (from === -1) return;
        const to = Math.max(0, Math.min(current.length - 1, targetIndex));
        if (from === to) return;

        const next = [...current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);

        rolesRef.current = next;
        setRoles(next);
        persistRoleOrder(next);
    };

    const handleRoleDrop = (targetId) => {
        if (dragRoleId !== null && String(dragRoleId) !== String(targetId)) {
            const to = rolesRef.current.findIndex(r => String(r.id) === String(targetId));
            if (to !== -1) moveRoleToIndex(dragRoleId, to);
        }
        setDragRoleId(null);
        setDragOverRoleId(null);
    };

    const handleRoleHandleKeyDown = (e, roleId) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        e.stopPropagation();
        const from = rolesRef.current.findIndex(r => String(r.id) === String(roleId));
        if (from !== -1) moveRoleToIndex(roleId, from + (e.key === 'ArrowUp' ? -1 : 1));
    };

    // First free "<name> (Copy N)". Matches the server-side fallback, and the
    // comparison is lower-cased because platform_roles.name is unique under a
    // case-insensitive collation.
    const suggestCopyName = (baseName) => {
        const taken = new Set(roles.map(r => r.name.toLowerCase()));
        for (let i = 1; i <= 50; i++) {
            const suffix = i === 1 ? ' (Copy)' : ` (Copy ${i})`;
            const candidate = baseName.slice(0, 100 - suffix.length) + suffix;
            if (!taken.has(candidate.toLowerCase())) return candidate;
        }
        return '';
    };

    const handleSaveRole = async (e) => {
        e.preventDefault();
        const action = showRoleModal === 'edit' ? 'update'
            : showRoleModal === 'duplicate' ? 'duplicate'
            : 'create';
        setIsSavingRole(true);
        try {
            const res = await fetch('./api/manage_login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    type: 'role', 
                    action, 
                    name: roleForm.name,
                    id: action === 'duplicate' ? undefined : selectedRole?.id,
                    source_id: action === 'duplicate' ? selectedRole?.id : undefined
                })
            });
            const data = await res.json();
            if (data.success) {
                // Jump to the copy so its inherited access is visible right away
                if (action === 'duplicate' && data.id) setPendingRoleSelectId(String(data.id));
                setShowRoleModal(false);
                fetchData();
            } else {
                alert(data.error || "Error saving role");
            }
        } catch (err) {
            alert("Error saving role");
        } finally {
            setIsSavingRole(false);
        }
    };

    const handleDeleteRole = async (role) => {
        if (role.is_system == 1) return alert("The built-in administrator role cannot be deleted.");
        if (!window.confirm(`Are you sure you want to delete the role "${role.name}"?`)) return;
        
        try {
            const res = await fetch('./api/manage_login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'role', action: 'delete', id: role.id })
            });
            const data = await res.json();
            if (data.success) {
                if (selectedRole?.id === role.id) setSelectedRole(null);
                fetchData();
            } else {
                alert(data.error || "Error deleting role");
            }
        } catch (err) {
            alert("Error deleting role");
        }
    };

    const handleDeleteUser = async (id) => {
        if (!window.confirm("Are you sure you want to delete this user?")) return;
        try {
            await fetch('./api/manage_login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'user', action: 'delete', id })
            });
            fetchData();
        } catch (err) {
            alert("Error deleting user");
        }
    }

    if (isLoading) return <div className="loading-state">Loading Security Suite...</div>;

    return (
        <div className="login-mgmt-container">
            <header className="login-mgmt-header">
                <h1>User Management</h1>
                <p>Configure user access, dynamic roles, and platform permissions.</p>
                <div className="tab-navigation">
                    <button className={activeTab === 'users' ? 'active' : ''} onClick={() => setActiveTab('users')}>Users</button>
                    <button className={activeTab === 'roles' ? 'active' : ''} onClick={() => setActiveTab('roles')}>Roles & Access</button>
                    <button className={activeTab === 'default-password' ? 'active' : ''} onClick={() => setActiveTab('default-password')}>Default Password</button>
                </div>
            </header>

            <main className="login-mgmt-content">
                {activeTab === 'users' && (
                    <div className="users-section">
                        <div className="section-header">
                            <h2>Platform Users</h2>
                            <button className="add-btn" onClick={() => {
                                setSelectedUser(null);
                                setUserForm({ username: '', password: defaultPassword, full_name: '', role_id: roles[0]?.id || '', status: 'active' });
                                setShowUserModal(true);
                            }}>+ New User</button>
                        </div>
                        <div className="table-responsive">
                            <table className="mgmt-table">
                                <thead>
                                    <tr>
                                        <th>Full Name</th>
                                        <th>Username</th>
                                        <th>Role</th>
                                        <th>Status</th>
                                        <th>Last Login</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        const indexOfLastUser = currentPage * usersPerPage;
                                        const indexOfFirstUser = indexOfLastUser - usersPerPage;
                                        const currentUsers = users.slice(indexOfFirstUser, indexOfLastUser);
                                        
                                        return currentUsers.map(user => (
                                            <tr key={user.id}>
                                                <td>{user.full_name}</td>
                                                <td>{user.username}</td>
                                                <td><span className="badge role-badge">{user.role_name}</span></td>
                                                <td><span className={`badge status-badge ${user.status}`}>{user.status}</span></td>
                                                <td>{user.last_login || 'Never'}</td>
                                                <td className="actions-cell">
                                                    <button className="icon-btn edit" title="Edit User" onClick={() => {
                                                        setSelectedUser(user);
                                                        setUserForm({ ...user, password: '' });
                                                        setShowUserModal(true);
                                                    }}>✏️</button>
                                                    <button
                                                        className="icon-btn delete"
                                                        title={String(user.id) === String(currentUserId)
                                                            ? 'You cannot delete your own account'
                                                            : 'Delete User'}
                                                        disabled={String(user.id) === String(currentUserId)}
                                                        onClick={() => handleDeleteUser(user.id)}
                                                    >🗑️</button>
                                                </td>
                                            </tr>
                                        ));
                                    })()}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Controls */}
                        {users.length > usersPerPage && (
                            <div className="pagination">
                                <button 
                                    className="pagination-btn" 
                                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                    disabled={currentPage === 1}
                                >
                                    Previous
                                </button>
                                
                                <div className="pagination-pages">
                                    {Array.from({ length: Math.ceil(users.length / usersPerPage) }, (_, i) => (
                                        <button 
                                            key={i + 1}
                                            className={`pagination-btn ${currentPage === i + 1 ? 'active' : ''}`}
                                            onClick={() => setCurrentPage(i + 1)}
                                        >
                                            {i + 1}
                                        </button>
                                    ))}
                                </div>

                                <button 
                                    className="pagination-btn" 
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(users.length / usersPerPage)))}
                                    disabled={currentPage === Math.ceil(users.length / usersPerPage)}
                                >
                                    Next
                                </button>
                                
                                <span className="pagination-info">
                                    Showing {Math.min(users.length, (currentPage - 1) * usersPerPage + 1)}-{Math.min(users.length, currentPage * usersPerPage)} of {users.length} users
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'roles' && (
                    <div className="roles-section">
                        <div className="roles-grid">
                            <aside className="roles-list">
                                <div className="roles-list-header">
                                    <h3>Available Roles</h3>
                                    {roleOrderStatus && (
                                        <span className={`role-order-status ${roleOrderStatus}`}>
                                            {roleOrderStatus === 'saving' ? 'Saving order...' : 'Order saved'}
                                        </span>
                                    )}
                                    <button className="add-role-btn small" title="Create New Role" onClick={() => {
                                        setRoleForm({ name: '' });
                                        setShowRoleModal('create');
                                    }}>+</button>
                                </div>

                                {roles.map(role => (
                                    <div 
                                        key={role.id} 
                                        className={[
                                            'role-item',
                                            selectedRole?.id === role.id ? 'selected' : '',
                                            String(dragRoleId) === String(role.id) ? 'dragging' : '',
                                            String(dragOverRoleId) === String(role.id) ? 'drag-over' : ''
                                        ].filter(Boolean).join(' ')}
                                        draggable
                                        onDragStart={(e) => {
                                            setDragRoleId(role.id);
                                            e.dataTransfer.effectAllowed = 'move';
                                            // Firefox refuses to start a drag without payload
                                            e.dataTransfer.setData('text/plain', String(role.id));
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                            if (String(dragOverRoleId) !== String(role.id)) setDragOverRoleId(role.id);
                                        }}
                                        onDragLeave={() => setDragOverRoleId(prev => (String(prev) === String(role.id) ? null : prev))}
                                        onDrop={(e) => { e.preventDefault(); handleRoleDrop(role.id); }}
                                        onDragEnd={() => { setDragRoleId(null); setDragOverRoleId(null); }}
                                        onClick={() => setSelectedRole(role)}
                                    >
                                        <div className="role-item-main">
                                            <span
                                                className="role-drag-handle"
                                                role="button"
                                                tabIndex={0}
                                                aria-label={`Reorder ${role.name}`}
                                                title="Drag to reorder, or focus and press the up / down arrows"
                                                onClick={(e) => e.stopPropagation()}
                                                onKeyDown={(e) => handleRoleHandleKeyDown(e, role.id)}
                                            >⠿</span>
                                            <span className="role-item-name">{role.name}</span>
                                        </div>
                                        <div className="role-item-actions">
                                            <button
                                                className="role-action-btn edit"
                                                title={role.is_system == 1
                                                    ? 'The built-in administrator role cannot be renamed'
                                                    : 'Rename Role'}
                                                disabled={role.is_system == 1}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedRole(role);
                                                    setRoleForm({ name: role.name });
                                                    setShowRoleModal('edit');
                                                }}
                                            >✏️</button>
                                            <button className="role-action-btn duplicate" title="Duplicate Role" onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedRole(role);
                                                setRoleForm({ name: suggestCopyName(role.name) });
                                                setShowRoleModal('duplicate');
                                            }}>📋</button>
                                            <button
                                                className="role-action-btn delete"
                                                title={role.is_system == 1
                                                    ? 'The built-in administrator role cannot be deleted'
                                                    : 'Delete Role'}
                                                disabled={role.is_system == 1}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteRole(role);
                                                }}
                                            >🗑️</button>
                                        </div>
                                    </div>
                                ))}
                                <button className="add-role-btn full" onClick={() => {
                                    setRoleForm({ name: '' });
                                    setShowRoleModal('create');
                                }}>+ Create Role</button>
                            </aside>
                            
                            <section className="permissions-manager">
                                {selectedRole ? (
                                    <>
                                        <div className="section-sub-nav">
                                            <div className="role-info-header">
                                                <h3>Access for {selectedRole.name}</h3>
                                                {isDirty && (
                                                    <div className="save-actions">
                                                        <button className="discard-btn" onClick={handleDiscardChanges}>Discard</button>
                                                        <button className="save-btn" onClick={handleSaveAccess} disabled={isSavingAccess}>
                                                            {isSavingAccess ? 'Saving...' : 'Save Changes'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="sub-tabs-container">
                                                <div className="sub-tabs">
                                                    <button className={roleView === 'modules' ? 'active' : ''} onClick={() => setRoleView('modules')}>Modules</button>
                                                    <button className={roleView === 'teams' ? 'active' : ''} onClick={() => setRoleView('teams')}>Teams</button>
                                                </div>
                                                <div className="bulk-actions">
                                                    <button className="bulk-btn" onClick={() => handleBulkSelect(roleView, 'all')}>Select All</button>
                                                    <button className="bulk-btn" onClick={() => handleBulkSelect(roleView, 'none')}>Deselect All</button>
                                                </div>
                                            </div>
                                        </div>

                                        {roleView === 'modules' ? (
                                            <>
                                                <p className="helper-text">Toggle the modules this role can see in the sidebar.</p>
                                                <div className="permissions-grid">
                                                    {MODULES.map(module => (
                                                        <div key={module.id} className="permission-card">
                                                            <label className="switch-container">
                                                                <div className="module-info">
                                                                    <span className="module-label">{module.label}</span>
                                                                    <span className="module-cat">{module.category}</span>
                                                                </div>
                                                                <input 
                                                                    type="checkbox" 
                                                                    checked={stagedPermissions.has(module.id)}
                                                                    onChange={() => handleTogglePermission(module.id)}
                                                                />
                                                                <span className="slider"></span>
                                                            </label>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="team-scope-switch">
                                                    <label className={stagedTeamScope === 'all' ? 'active' : ''}>
                                                        <input
                                                            type="radio"
                                                            name="team-scope"
                                                            checked={stagedTeamScope === 'all'}
                                                            onChange={() => setStagedTeamScope('all')}
                                                        />
                                                        <span>
                                                            <strong>All teams</strong>
                                                            <em>Sees data for every team, now and for any team added later.</em>
                                                        </span>
                                                    </label>
                                                    <label className={stagedTeamScope === 'selected' ? 'active' : ''}>
                                                        <input
                                                            type="radio"
                                                            name="team-scope"
                                                            checked={stagedTeamScope === 'selected'}
                                                            onChange={() => setStagedTeamScope('selected')}
                                                        />
                                                        <span>
                                                            <strong>Only selected teams</strong>
                                                            <em>Sees nothing until a team is ticked below.</em>
                                                        </span>
                                                    </label>
                                                </div>
                                                <p className="helper-text">
                                                    {stagedTeamScope === 'all'
                                                        ? 'This role ignores the selection below and sees every team.'
                                                        : 'Only the ticked teams are visible to this role.'}
                                                </p>
                                                <div className={`permissions-grid ${stagedTeamScope === 'all' ? 'scope-disabled' : ''}`}>
                                                    {orgTeams.map(team => (
                                                        <div key={team.id} className="permission-card">
                                                            <label className="switch-container">
                                                                <div className="module-info">
                                                                    <span className="module-label">{team.name}</span>
                                                                    <span className="module-cat">TEAM ID: {team.id}</span>
                                                                </div>
                                                                <input 
                                                                    type="checkbox" 
                                                                    checked={stagedTeams.has(team.id)}
                                                                    onChange={() => handleToggleTeamAccess(team.id)}
                                                                />
                                                                <span className="slider"></span>
                                                            </label>
                                                        </div>
                                                    ))}
                                                    {orgTeams.length === 0 && <p>No teams found in organization settings.</p>}
                                                </div>
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <div className="no-selection">
                                        <p>Select a role to manage its permissions.</p>
                                    </div>
                                )}
                            </section>
                        </div>
                    </div>
                )}

                {activeTab === 'default-password' && (
                    <div className="default-password-section">
                        <div className="section-header">
                            <h2>Default Password</h2>
                            <span className={`badge status-badge ${defaultPassword ? 'active' : 'inactive'}`}>
                                {defaultPassword ? 'Configured' : 'Not set'}
                            </span>
                        </div>
                        <form className="default-password-card" onSubmit={handleSaveDefaultPassword}>
                            <p className="helper-text">
                                This password is applied automatically to every new user created from the Users tab,
                                and it is the value the <strong>Reset Password</strong> button fills in when editing a user.
                            </p>
                            <div className="form-field">
                                <label>Password</label>
                                <div className="password-input-row">
                                    <input
                                        type={showDefaultPassword ? 'text' : 'password'}
                                        value={defaultPasswordDraft}
                                        onChange={e => setDefaultPasswordDraft(e.target.value)}
                                        placeholder="Enter the default password..."
                                        autoComplete="new-password"
                                    />
                                    <button type="button" className="bulk-btn" onClick={() => setShowDefaultPassword(v => !v)}>
                                        {showDefaultPassword ? 'Hide' : 'Show'}
                                    </button>
                                </div>
                            </div>
                            <p className="default-password-note">
                                Stored as written so it can be displayed and re-applied here. Only Admins can open this page.
                                Leave it blank to require a password to be typed on every new user.
                            </p>
                            <div className="default-password-actions">
                                <button
                                    type="button"
                                    className="discard-btn"
                                    onClick={() => setDefaultPasswordDraft(defaultPassword)}
                                    disabled={defaultPasswordDraft === defaultPassword}
                                >
                                    Discard
                                </button>
                                <button
                                    type="submit"
                                    className="save-btn"
                                    disabled={isSavingDefaultPassword || defaultPasswordDraft === defaultPassword}
                                >
                                    {isSavingDefaultPassword ? 'Saving...' : 'Save Default Password'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </main>

            {/* User Modal */}
            {showUserModal && (() => { const isEditingSelf = selectedUser && String(selectedUser.id) === String(currentUserId); return (
                <div className="modal-overlay">
                    <div className="mgmt-modal">
                        <h3>{selectedUser ? 'Edit User' : 'Create New User'}</h3>
                        <form onSubmit={handleSaveUser}>
                            <div className="form-grid">
                                <div className="form-field">
                                    <label>Full Name</label>
                                    <input value={userForm.full_name} onChange={e => setUserForm({...userForm, full_name: e.target.value})} required />
                                </div>
                                <div className="form-field">
                                    <label>Username</label>
                                    <input value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} required />
                                </div>
                                <div className="form-field">
                                    <div className="password-label-row">
                                        <label>Password {selectedUser && '(Leave blank to keep current)'}</label>
                                        <button
                                            type="button"
                                            className="reset-password-btn"
                                            onClick={() => setUserForm({...userForm, password: defaultPassword})}
                                            disabled={!defaultPassword}
                                            title={defaultPassword
                                                ? 'Fill in the password configured in the Default Password tab'
                                                : 'No default password configured yet - set one in the Default Password tab'}
                                        >
                                            Reset Password
                                        </button>
                                    </div>
                                    <input type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} required={!selectedUser} />
                                </div>
                                <div className="form-field">
                                    <label>Role</label>
                                    <select
                                        value={userForm.role_id}
                                        onChange={e => setUserForm({...userForm, role_id: e.target.value})}
                                        disabled={isEditingSelf}
                                        required
                                    >
                                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                </div>
                                <div className="form-field">
                                    <label>Status</label>
                                    <select
                                        value={userForm.status}
                                        onChange={e => setUserForm({...userForm, status: e.target.value})}
                                        disabled={isEditingSelf}
                                    >
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                    </select>
                                </div>
                                {isEditingSelf && (
                                    <p className="self-edit-note">
                                        This is your own account. Another administrator has to change your role or
                                        deactivate you, so nobody can lock themselves out.
                                    </p>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button type="button" onClick={() => setShowUserModal(false)}>Cancel</button>
                                <button type="submit" className="save-btn">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            ); })()}

            {/* Role Modal */}
            {showRoleModal && (
                <div className="modal-overlay">
                    <div className="mgmt-modal role-modal">
                        <h3>
                            {showRoleModal === 'edit' ? 'Rename Role'
                                : showRoleModal === 'duplicate' ? 'Duplicate Role'
                                : 'Create New Role'}
                        </h3>
                        {showRoleModal === 'duplicate' && selectedRole && (
                            <p className="helper-text">
                                Copies every module permission and team assignment from <strong>{selectedRole.name}</strong> into
                                the new role. Users stay on their current role.
                            </p>
                        )}
                        <form onSubmit={handleSaveRole}>
                            <div className="form-field">
                                <label>Role Name</label>
                                <input 
                                    value={roleForm.name} 
                                    onChange={e => setRoleForm({ name: e.target.value })} 
                                    placeholder="Enter role name..."
                                    autoFocus
                                    required 
                                />
                            </div>
                            <div className="modal-footer">
                                <button type="button" onClick={() => setShowRoleModal(false)}>Cancel</button>
                                <button type="submit" className="save-btn" disabled={isSavingRole}>
                                    {isSavingRole ? 'Saving...'
                                        : showRoleModal === 'duplicate' ? 'Duplicate Role'
                                        : 'Save Role'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LoginManagement;
