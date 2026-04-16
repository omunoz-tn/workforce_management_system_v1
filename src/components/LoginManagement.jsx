import React, { useState, useEffect, useMemo } from 'react';
import './LoginManagement.css';

const MODULES = [
    { id: 'dashboard', label: 'Dashboard', category: 'General' },
    { id: 'all-emp', label: 'All Employees (Desktime)', category: 'Employees' },
    { id: 'employee-roster', label: 'Employee Roster', category: 'Employees' },
    { id: 'teams', label: 'Teams', category: 'Employees' },
    { id: 'billable', label: 'Billable Status', category: 'Employees' },
    { id: 'reports', label: 'Reports', category: 'Analytics' },
    { id: 'kpi', label: 'KPIs', category: 'Analytics' },
    { id: 'save-hours', label: 'Save Hours', category: 'Analytics' },
    { id: 'save-projects', label: 'Save Projects', category: 'Analytics' },
    { id: 'schedule-board', label: 'Schedule Board', category: 'Scheduling' },
    { id: 'forecast', label: 'Forecast', category: 'Scheduling' },
    { id: 'coverage', label: 'Coverage', category: 'Scheduling' },
    { id: 'shift-mgmt', label: 'Shift Management', category: 'Scheduling' },
    { id: 'time-off', label: 'Time Off', category: 'Scheduling' },
    { id: 'settings-dashboard', label: 'Dashboard Settings', category: 'Settings' },
    { id: 'settings-reports', label: 'Report Settings', category: 'Settings' },
    { id: 'org', label: 'Organization', category: 'Settings' },
    { id: 'login-mgmt', label: 'Login (Users & Roles)', category: 'Settings' },
];

const LoginManagement = () => {
    const [activeTab, setActiveTab] = useState('users');
    const [users, setUsers] = useState([]);
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
    const [isSavingAccess, setIsSavingAccess] = useState(false);

    // Form states
    const [userForm, setUserForm] = useState({ username: '', password: '', full_name: '', role_id: '', status: 'active' });
    const [roleForm, setRoleForm] = useState({ name: '' });

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
        }
    }, [selectedRole, permissions, roleTeams]);

    const isDirty = useMemo(() => {
        if (!selectedRole) return false;
        
        const currentPermsFiltered = permissions.filter(p => p.role_id === selectedRole.id).map(p => p.menu_item_id);
        const currentTeamsFiltered = roleTeams.filter(rt => rt.role_id === selectedRole.id).map(rt => rt.team_id);
        
        const permsChanged = currentPermsFiltered.length !== stagedPermissions.size || currentPermsFiltered.some(id => !stagedPermissions.has(id));
        const teamsChanged = currentTeamsFiltered.length !== stagedTeams.size || currentTeamsFiltered.some(id => !stagedTeams.has(id));
        
        return permsChanged || teamsChanged;
    }, [selectedRole, permissions, roleTeams, stagedPermissions, stagedTeams]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('./api/manage_login.php?action=list_all');
            const data = await res.json();
            if (data.success) {
                setUsers(data.users);
                setRoles(data.roles);
                setPermissions(data.permissions);
                setRoleTeams(data.role_teams || []);
                setOrgTeams(data.org_teams || []);
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
            }
        } catch (err) {
            alert("Error saving user");
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

    const handleSaveRole = async (e) => {
        e.preventDefault();
        const action = showRoleModal === 'edit' ? 'update' : 'create';
        try {
            const res = await fetch('./api/manage_login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    type: 'role', 
                    action, 
                    name: roleForm.name,
                    id: selectedRole?.id 
                })
            });
            const data = await res.json();
            if (data.success) {
                setShowRoleModal(false);
                fetchData();
            }
        } catch (err) {
            alert("Error saving role");
        }
    };

    const handleDeleteRole = async (role) => {
        if (role.name === 'Admin') return alert("Cannot delete the Admin role.");
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
                <h1>Login Management</h1>
                <p>Configure user access, dynamic roles, and platform permissions.</p>
                <div className="tab-navigation">
                    <button className={activeTab === 'users' ? 'active' : ''} onClick={() => setActiveTab('users')}>Users</button>
                    <button className={activeTab === 'roles' ? 'active' : ''} onClick={() => setActiveTab('roles')}>Roles & Access</button>
                </div>
            </header>

            <main className="login-mgmt-content">
                {activeTab === 'users' ? (
                    <div className="users-section">
                        <div className="section-header">
                            <h2>Platform Users</h2>
                            <button className="add-btn" onClick={() => {
                                setSelectedUser(null);
                                setUserForm({ username: '', password: '', full_name: '', role_id: roles[0]?.id || '', status: 'active' });
                                setShowUserModal(true);
                            }}>+ New User</button>
                        </div>
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
                                {users.map(user => (
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
                                            <button className="icon-btn delete" title="Delete User" onClick={() => handleDeleteUser(user.id)}>🗑️</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="roles-section">
                        <div className="roles-grid">
                            <aside className="roles-list">
                                <div className="roles-list-header">
                                    <h3>Available Roles</h3>
                                    <button className="add-role-btn small" title="Create New Role" onClick={() => {
                                        setRoleForm({ name: '' });
                                        setShowRoleModal('create');
                                    }}>+</button>
                                </div>
                                {roles.map(role => (
                                    <div 
                                        key={role.id} 
                                        className={`role-item ${selectedRole?.id === role.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedRole(role)}
                                    >
                                        <span className="role-item-name">{role.name}</span>
                                        <div className="role-item-actions">
                                            <button className="role-action-btn edit" title="Rename Role" onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedRole(role);
                                                setRoleForm({ name: role.name });
                                                setShowRoleModal('edit');
                                            }}>✏️</button>
                                            <button className="role-action-btn delete" title="Delete Role" onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteRole(role);
                                            }}>🗑️</button>
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
                                                <p className="helper-text">Select which teams this role is allowed to see data for. Leave all unchecked for global access (Admin).</p>
                                                <div className="permissions-grid">
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
            </main>

            {/* User Modal */}
            {showUserModal && (
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
                                    <label>Password {selectedUser && '(Leave blank to keep current)'}</label>
                                    <input type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} required={!selectedUser} />
                                </div>
                                <div className="form-field">
                                    <label>Role</label>
                                    <select value={userForm.role_id} onChange={e => setUserForm({...userForm, role_id: e.target.value})} required>
                                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                </div>
                                <div className="form-field">
                                    <label>Status</label>
                                    <select value={userForm.status} onChange={e => setUserForm({...userForm, status: e.target.value})}>
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                    </select>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" onClick={() => setShowUserModal(false)}>Cancel</button>
                                <button type="submit" className="save-btn">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Role Modal */}
            {showRoleModal && (
                <div className="modal-overlay">
                    <div className="mgmt-modal role-modal">
                        <h3>{showRoleModal === 'edit' ? 'Rename Role' : 'Create New Role'}</h3>
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
                                <button type="submit" className="save-btn">Save Role</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LoginManagement;
