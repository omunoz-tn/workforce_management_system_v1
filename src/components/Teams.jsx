import React, { useState, useEffect } from 'react';
import './Teams.css';
import LoadingScreen from './LoadingScreen';
// Same source of truth the Holidays module uses, so the type labels and country flags
// can't drift between the two screens.
import { HOLIDAY_TYPES, COUNTRIES, FlagIcon } from './Holidays';

// ── SVG Icon Components ─────────────────────────────────────────────────────
const IconEdit = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 7.125L18 8.625" />
    </svg>
);
const IconTrash = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
);
const IconEye = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);
const IconEyeOff = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
);
const IconHistory = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);
const IconPlus = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
);
const IconChevronRight = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
);
const IconChevronLeft = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
);

// A holiday date is shown as-is from the DB; parsing at noon avoids the UTC shift that
// makes `new Date('2026-01-01')` render as Dec 31 in western timezones.
const formatHolidayDate = (dateStr) =>
    new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });

const getHolidayCountry = (code) =>
    COUNTRIES.find(c => c.code === code) || { code, name: code, flag: '🏳️' };

// ── Search Helpers ──────────────────────────────────────────────────────────
// Decompose to NFD and drop the combining marks so any diacritic is ignored
// ("josias" finds "Josías", "munoz" finds "Muñoz") without listing characters.
const normalizeForSearch = (value) =>
    (value || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const matchesSearch = (emp, term) => {
    const query = normalizeForSearch(term);
    if (!query) return true;
    return normalizeForSearch(emp.name).includes(query) ||
        normalizeForSearch(emp.group_name).includes(query);
};

// ── Teams Component ─────────────────────────────────────────────────────────
const Teams = ({ onUnsavedChanges }) => {
    const [hierarchy, setHierarchy] = useState([]);
    const [allEmployees, setAllEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Modal states
    const [showOrgModal, setShowOrgModal] = useState(false);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);

    // Editing state
    const [editingItem, setEditingItem] = useState(null);
    const [selectedTeam, setSelectedTeam] = useState(null);
    const [selectedMembers, setSelectedMembers] = useState([]);
    const [showOnlySelected, setShowOnlySelected] = useState(false);
    const [history, setHistory] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [managerSearchTerm, setManagerSearchTerm] = useState('');
    const [lunchTime, setLunchTime] = useState(60);

    // Assign Members modal paging: 'members' is the default page, 'holidays' is the
    // per-team holiday calendar reached through the Holidays row.
    const [assignPage, setAssignPage] = useState('members');
    const [teamHolidays, setTeamHolidays] = useState([]);
    // holiday_id -> type currently chosen in the modal (always the effective type, never
    // null, so the <select> stays controlled).
    const [holidayTypeDraft, setHolidayTypeDraft] = useState({});
    const [holidayYears, setHolidayYears] = useState([]);
    const [holidayYear, setHolidayYear] = useState(String(new Date().getFullYear()));
    const [holidaysLoading, setHolidaysLoading] = useState(false);
    const [holidaysError, setHolidaysError] = useState(null);
    // Guards the save: POST replaces the team's whole override set, so submitting a draft
    // that never loaded (fetch failed, or Save clicked mid-load) would silently wipe every
    // override the team had. Only a confirmed load is allowed to write.
    const [holidaysLoaded, setHolidaysLoaded] = useState(false);

    // Import from DeskTime state
    const [dtGroups, setDtGroups] = useState([]);
    const [selectedImport, setSelectedImport] = useState([]);
    const [autoAssign, setAutoAssign] = useState(true);
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState(null);

    // Batch Save State
    const [pendingChanges, setPendingChanges] = useState([]);
    const [savingBatch, setSavingBatch] = useState(false);

    // ── Initial Load (only API fetch besides Import) ──────────────────────
// State for caching team members
  const [teamMembersMap, setTeamMembersMap] = useState({});

  // ── Initial Load (fetch hierarchy, employees, and preload all team members) ────────
  const fetchData = async () => {
    setLoading(true);
    try {
      // 1️⃣ Load hierarchy and employee list
      const [hierarchyRes, employeesRes] = await Promise.all([
        fetch('./api/get_org_hierarchy.php'),
        fetch('./api/get_online_employees.php?status=all')
      ]);
      const hierarchyData = await hierarchyRes.json();
      const employeesData = await employeesRes.json();
      if (hierarchyData.success) setHierarchy(hierarchyData.data);
      if (employeesData.success) {
        // The source data can contain multiple rows per employee_id (e.g. one
        // per DeskTime sync/account); keep a single card per employee here.
        const uniqueEmployees = Array.from(
          new Map(employeesData.data.map(emp => [emp.employee_id, emp])).values()
        );
        setAllEmployees(uniqueEmployees);
      }

      // 2️⃣ Pre‑load members for every existing team (skip temporary IDs)
      const teams = (hierarchyData.data || []).flatMap(g =>
        (g.teams || []).filter(t => !String(t.id).startsWith('temp_'))
      );
      const membersMap = {};
      await Promise.all(
        teams.map(async (team) => {
          try {
            const res = await fetch(`./api/get_team_members.php?team_id=${team.id}`);
            const data = await res.json();
            membersMap[team.id] = data.success ? data.data : [];
          } catch (_) {
            membersMap[team.id] = [];
          }
        })
      );
      setTeamMembersMap(membersMap);
    } catch (err) {
      setError('Failed to load organization data');
    } finally {
      setLoading(false);
    }
  };

    useEffect(() => { fetchData(); }, []);

    // ── Unsaved Changes Hook ──────────────────────────────────────────────
    useEffect(() => {
        const hasUnsaved = pendingChanges.length > 0;
        if (onUnsavedChanges) onUnsavedChanges(hasUnsaved);

        const handleBeforeUnload = (e) => {
            if (hasUnsaved) {
                e.preventDefault();
                e.returnValue = '';
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            // reset on unmount if it was just navigated away
            if (onUnsavedChanges) onUnsavedChanges(false);
        };
    }, [pendingChanges, onUnsavedChanges]);

    // ── Optimistic State Helpers ──────────────────────────────────────────
    const addGroupLocally = (group) => {
        setHierarchy(prev => [...prev, { ...group, type: 'group', managers: [], teams: [] }]);
    };

    const updateGroupLocally = (id, changes) => {
        setHierarchy(prev => prev.map(g =>
            g.id === id ? { ...g, ...changes } : g
        ));
    };

    const removeGroupLocally = (id) => {
        setHierarchy(prev => prev.filter(g => g.id !== id));
    };

    const addTeamLocally = (groupId, team) => {
        setHierarchy(prev => prev.map(g =>
            g.id === groupId ? { ...g, teams: [...g.teams, { ...team, type: 'team', managers: [], member_count: 0 }] } : g
        ));
    };

    const updateTeamLocally = (groupId, teamId, changes) => {
        setHierarchy(prev => prev.map(g => ({
            ...g,
            teams: g.teams.map(t => (t.id === teamId ? { ...t, ...changes } : t))
        })));
    };

    const removeTeamLocally = (groupId, teamId) => {
        setHierarchy(prev => prev.map(g =>
            g.id === groupId ? { ...g, teams: g.teams.filter(t => t.id !== teamId) } : g
        ));
    };

    // ── CRUD Handlers (optimistic — no fetchData) ─────────────────────────
    const handleSaveOrg = (e) => {
        e.preventDefault();
        const isNew = !editingItem.id;
        const managers = editingItem.managers || [];
        // Generate a temporary ID if new
        const tempId = isNew ? `temp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` : editingItem.id;

        const groupIdVal = editingItem.type === 'team' ? editingItem.group_id : null;
        
        if (editingItem.type === 'team' && !groupIdVal) {
            alert('Please select a Parent Group for this team.');
            return;
        }

        const actionObj = {
            action: isNew ? 'create' : 'update',
            type: editingItem.type,
            id: editingItem.id,
            temp_id: isNew ? tempId : null,
            name: editingItem.name,
            group_id: groupIdVal,
            is_visible: 1,
            managers: managers
        };

        if (editingItem.type === 'group') {
            if (isNew) {
                addGroupLocally({ id: tempId, name: editingItem.name, is_visible: 1, managers: managers.map(m => ({ manager_name: m })) });
            } else {
                updateGroupLocally(editingItem.id, { name: editingItem.name, managers: managers.map(m => ({ manager_name: m })) });
            }
        } else {
            const numericGroupId = Number(editingItem.group_id);
            const groupId = isNaN(numericGroupId) ? editingItem.group_id : numericGroupId;
            if (isNew) {
                addTeamLocally(groupId, { id: tempId, name: editingItem.name, group_id: groupId, is_visible: 1, managers: managers.map(m => ({ manager_name: m })) });
            } else {
                updateTeamLocally(groupId, editingItem.id, { name: editingItem.name, group_id: groupId, managers: managers.map(m => ({ manager_name: m })) });
            }
        }

        setPendingChanges(prev => [...prev, actionObj]);
        setShowOrgModal(false);
    };

    // Managers are stored as free text (org_team_managers.manager_name), so a name
    // that is not in the employee list is still valid — external managers or people
    // not yet synced from DeskTime can be typed in directly.
    const addManager = (rawName) => {
        const name = rawName.trim();
        if (!name) return;
        setEditingItem(prev => ({
            ...prev,
            managers: prev.managers.includes(name) ? prev.managers : [...prev.managers, name]
        }));
        setManagerSearchTerm('');
    };

    const handleToggleVisibility = (type, id, groupId, current) => {
        const newVal = current ? 0 : 1;
        if (type === 'group') updateGroupLocally(id, { is_visible: newVal });
        else updateTeamLocally(groupId, id, { is_visible: newVal });

        setPendingChanges(prev => [...prev, {
            action: 'toggle_visibility',
            type,
            id,
            is_visible: newVal
        }]);
    };

    const handleDelete = (type, id, groupId, name) => {
        if (!window.confirm(`Delete "${name}"? Actions will be queued for save.`)) return;

        if (type === 'group') removeGroupLocally(id);
        else removeTeamLocally(groupId, id);

        // If it's a temporary ID we just created, we can just remove it from pendingChanges
        if (String(id).startsWith('temp_')) {
            setPendingChanges(prev => prev.filter(p => p.temp_id !== id));
            return;
        }

        setPendingChanges(prev => [...prev, {
            action: 'delete',
            type,
            id
        }]);
    };

    const handleSaveAllChanges = async () => {
        if (pendingChanges.length === 0) return;
        setSavingBatch(true);
        try {
            const res = await fetch('./api/manage_org.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ batch: true, actions: pendingChanges })
            });
            const result = await res.json();
            if (result.success) {
                setPendingChanges([]);
                await fetchData();
            } else {
                alert('Save encountered errors: ' + result.error);
            }
        } catch (err) {
            alert('Error connecting to server while saving.');
        } finally {
            setSavingBatch(false);
        }
    };

    // ── Assignment ────────────────────────────────────────────────────────
    // Loads every holiday with this team's effective type. A team that was never saved
    // has no id yet, so it asks for team 0 and gets the org-wide defaults back.
    // `seedTypes` re-applies unsaved choices when the modal is reopened before Save All.
    const loadTeamHolidays = async (team, seedTypes) => {
        const numericId = team.id && !String(team.id).startsWith('temp_') ? team.id : 0;
        setHolidaysLoading(true);
        setHolidaysError(null);
        setHolidaysLoaded(false);
        try {
            const res = await fetch(`./api/manage_team_holiday_types.php?team_id=${numericId}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to load holidays.');

            const holidays = json.holidays || [];
            setTeamHolidays(holidays);
            setHolidayYears([...new Set(holidays.map(h => h.holiday_date.slice(0, 4)))].sort());

            const draft = {};
            holidays.forEach(h => {
                draft[h.id] = seedTypes?.[h.id] ?? {
                    type: h.effective_type,
                    // Stored as HH:MM:SS but <input type="time"> wants HH:MM.
                    from: (h.exclude_from || '').slice(0, 5),
                    to: (h.exclude_to || '').slice(0, 5)
                };
            });
            setHolidayTypeDraft(draft);
            setHolidaysLoaded(true);
        } catch (err) {
            setHolidaysError(err.message || 'Failed to load holidays.');
            setTeamHolidays([]);
            setHolidayTypeDraft({});
        } finally {
            setHolidaysLoading(false);
        }
    };

    const handleOpenAssign = async (team) => {
        setSelectedTeam(team);
        setSearchTerm(''); // Clear search when opening
        setShowOnlySelected(false); // Always start showing everyone
        setAssignPage('members'); // Always open on the member list, never mid-flow

        // 1. Check if we already have pending assignments for this team ID (or temp ID)
        const pending = pendingChanges.find(p => p.action === 'assign_members' && (p.id === team.id || (p.temp_id && p.temp_id === team.id)));

        // Holidays are fetched either way — the pending change only carries the chosen
        // types, not the holiday names and dates needed to render the list.
        loadTeamHolidays(team, pending?.holiday_types);

        if (pending) {
            setSelectedMembers(pending.employee_ids || []);
            // Was missing: reopening a team with pending changes kept the previous team's
            // lunch time on screen, and Save would then write that stale value.
            setLunchTime(pending.lunch_time ?? team.lunch_time ?? 60);
            setShowAssignModal(true);
            return;
        }

        // 2. If no pending, and it's an existing team, fetch from API
        if (team.id && !String(team.id).startsWith('temp_')) {
            setSelectedMembers(teamMembersMap[team.id] || []);
        } else {
            // New team without pending assignments starts empty
            setSelectedMembers([]);
        }
        setLunchTime(team.lunch_time || 60);
        setShowAssignModal(true);
    };

    const handleSaveAssignments = () => {
        // A half-filled or backwards Campaign Defined window would be rejected by the
        // backend with a 400 after the modal already closed, so stop here and show it.
        if (invalidHolidayRanges.length > 0) {
            setAssignPage('holidays');
            return;
        }

        const teamId = selectedTeam.id;
        const isTemp = String(teamId).startsWith('temp_');

        const actionObj = {
            action: 'assign_members',
            type: 'team',
            id: isTemp ? null : teamId,
            temp_id: isTemp ? teamId : null,
            employee_ids: selectedMembers,
            lunch_time: lunchTime
        };

        // Full effective map, not just the customized ones: the backend drops entries that
        // match the org default, so what gets stored stays sparse either way. Omitted
        // entirely when the list never loaded — manage_org.php then leaves the team's
        // existing overrides alone instead of clearing them.
        if (holidaysLoaded) {
            actionObj.holiday_types = holidayTypeDraft;
        }

        // Update pending changes: remove any previous assignment for this team and add new
        setPendingChanges(prev => [
            ...prev.filter(p => !(p.action === 'assign_members' && (p.id === teamId || (p.temp_id && p.temp_id === teamId)))),
            actionObj
        ]);

        // Update member count and lunch time locally for immediate feedback
        updateTeamLocally(selectedTeam.group_id, teamId, { 
            member_count: selectedMembers.length,
            lunch_time: lunchTime
        });
        setShowAssignModal(false);
    };

    const toggleMemberSelection = (empId) => {
        setSelectedMembers(prev =>
            prev.includes(empId) ? prev.filter(id => id !== empId) : [...prev, empId]
        );
    };

    const handleSelectAll = () => {
        const filteredIds = allEmployees
            .filter(emp => matchesSearch(emp, searchTerm))
            .map(emp => emp.employee_id);
        
        setSelectedMembers(prev => {
            const next = new Set([...prev, ...filteredIds]);
            return Array.from(next);
        });
    };

    const handleDeselectAll = () => {
        const filteredIds = allEmployees
            .filter(emp => matchesSearch(emp, searchTerm))
            .map(emp => emp.employee_id);

        setSelectedMembers(prev => prev.filter(id => !filteredIds.includes(id)));
    };

    // ── History ───────────────────────────────────────────────────────────
    const fetchHistory = async (type, id) => {
        try {
            const res = await fetch(`./api/get_org_history.php?type=${type}&id=${id}`);
            const data = await res.json();
            if (data.success) { setHistory(data.data); setShowHistoryModal(true); }
        } catch (err) { console.error(err); }
    };

    // ── Import from DeskTime ──────────────────────────────────────────────
    const handleOpenImport = async () => {
        setImportResult(null);
        setSelectedImport([]);
        try {
            const res = await fetch('./api/get_desktime_groups.php');
            const data = await res.json();
            if (data.success) {
                setDtGroups(data.data);
                setSelectedImport(data.data.filter(g => !g.already_imported).map(g => g.group_name));
            }
        } catch (err) { console.error(err); }
        setShowImportModal(true);
    };

    const toggleImportSelection = (groupName) => {
        setSelectedImport(prev =>
            prev.includes(groupName) ? prev.filter(n => n !== groupName) : [...prev, groupName]
        );
    };

    const handleRunImport = async () => {
        const groups = dtGroups.filter(g => selectedImport.includes(g.group_name));
        if (!groups.length) return;
        setImporting(true);
        try {
            const res = await fetch('./api/import_desktime_groups.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groups, auto_assign: autoAssign })
            });
            const result = await res.json();
            if (result.success) {
                setImportResult(result);
                fetchData(); // Only auto-reload here for import
            }
        } catch (err) {
            alert('Import failed');
        } finally {
            setImporting(false);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────
    const managerQuery = managerSearchTerm.trim();
    const normalizedManagerQuery = normalizeForSearch(managerSearchTerm);
    const managerMatches = allEmployees.filter(emp =>
        normalizeForSearch(emp.name).includes(normalizedManagerQuery) &&
        !(editingItem?.managers || []).includes(emp.name)
    );

    // Shared by Team Lunch Time and the Holidays row so the two boxes stay visually
    // identical instead of being two copies of the same literal.
    const assignConfigBoxStyle = {
        marginBottom: '20px',
        padding: '15px',
        background: 'var(--surface-alt)',
        borderRadius: '10px',
        border: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
    };

    // The year picker only narrows what is displayed — the draft always covers every
    // holiday, because saving replaces the team's whole override set.
    const visibleHolidays = teamHolidays.filter(h =>
        holidayYear === 'all' || h.holiday_date.startsWith(holidayYear)
    );
    // Customized = a type the org default does not give, or a Campaign Defined window,
    // which is team-specific data even when the type itself matches the default.
    const customizedHolidayCount = teamHolidays.filter(h => {
        const entry = holidayTypeDraft[h.id];
        if (!entry) return false;
        return entry.type !== h.default_type || (entry.type === 'campaign_defined' && entry.from && entry.to);
    }).length;

    // Custom requires a time window — without one it behaves exactly like Working, so the
    // choice would mean nothing. The requirement applies to a Custom the team actually
    // picks, not to one merely inherited: an inherited Custom with no window stores no row
    // (see saveTeamHolidayTypes), so blocking on it would make an organization-wide type
    // change lock every team out of saving member assignments.
    const invalidHolidayRanges = teamHolidays.filter(h => {
        const entry = holidayTypeDraft[h.id];
        if (!entry) return false;

        const bothSet = Boolean(entry.from && entry.to);
        if (entry.from || entry.to) {
            if (!bothSet) return true;              // half-filled
            if (entry.to <= entry.from) return true; // ends before it starts
        }
        if (entry.type !== 'campaign_defined') return false;

        const isTeamChoice = entry.type !== h.default_type || bothSet;
        return isTeamChoice && !bothSet;
    });

    return (
        <div className="teams-container">
            <LoadingScreen loading={loading} message="Loading Organization..." />

            <header className="teams-header">
                <div>
                    <h1>Organization &amp; Teams</h1>
                    <p className="text-muted">Manage your hierarchical groups, teams, and member assignments.</p>
                </div>
                <div className="header-actions">
                    {pendingChanges.length > 0 && (
                        <button
                            className="btn-primary"
                            style={{ background: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }}
                            onClick={handleSaveAllChanges}
                            disabled={savingBatch}
                        >
                            {savingBatch ? 'Saving...' : `💾 Save All Changes`}
                        </button>
                    )}
                    <button className="btn-primary" onClick={() => {
                        setEditingItem({ type: 'group', name: '', managers: [] });
                        setShowOrgModal(true);
                    }}>+ New Group</button>
                    <button className="btn-primary" style={{ background: '#4f46e5' }} onClick={() => {
                        setEditingItem({ type: 'team', name: '', group_id: hierarchy[0]?.id, managers: [] });
                        setShowOrgModal(true);
                    }}>+ New Team</button>
                </div>
            </header>

            {/* ── Hierarchy Tree ── */}
            <div className="org-tree">
                {hierarchy.length === 0 && !loading && (
                    <div className="empty-state">
                        <p>No groups yet. Click <strong>"Import from DeskTime"</strong> to get started, or create a new Group manually.</p>
                    </div>
                )}
                {hierarchy.map(group => (
                    <div key={group.id} className="group-card">
                        <div className="group-header">
                            <div className="group-info">
                                <h2>
                                    <span className="tag-group">Group</span>
                                    {group.name}
                                    <span style={{
                                        fontSize: '0.65rem',
                                        fontWeight: 600,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                        background: 'rgba(100, 108, 255, 0.08)',
                                        color: 'var(--text-muted)',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        border: '1px solid var(--border-color)'
                                    }}>
                                        {group.teams.length} {group.teams.length === 1 ? 'Team' : 'Teams'}
                                    </span>
                                    <span
                                        className={`visibility-dot ${group.is_visible ? 'visible' : 'hidden'}`}
                                        title={group.is_visible ? 'Visible in Dashboard' : 'Hidden from Dashboard'}
                                    />
                                </h2>
                                <div className="managers-list">
                                    {group.managers.map((m, i) => (
                                        <span key={i} className="manager-badge">👤 {m.manager_name}</span>
                                    ))}
                                </div>
                            </div>
                            <div className="icon-actions">
                                <button className="icon-btn add-team" onClick={() => {
                                    setEditingItem({ type: 'team', name: '', group_id: group.id, managers: [] });
                                    setShowOrgModal(true);
                                }} title="Add Team to this Group">
                                    <IconPlus />
                                </button>
                                <button className="icon-btn history" onClick={() => fetchHistory('group', group.id)} title="History">
                                    <IconHistory />
                                </button>
                                <button
                                    className={`icon-btn vis ${group.is_visible ? 'active' : 'muted'}`}
                                    onClick={() => handleToggleVisibility('group', group.id, null, group.is_visible)}
                                    title={group.is_visible ? 'Hide from Dashboard' : 'Show in Dashboard'}
                                >
                                    {group.is_visible ? <IconEye /> : <IconEyeOff />}
                                </button>
                                <button className="icon-btn edit" onClick={() => {
                                    setEditingItem({ type: 'group', ...group, managers: group.managers.map(m => m.manager_name) });
                                    setShowOrgModal(true);
                                }} title="Edit">
                                    <IconEdit />
                                </button>
                                <button className="icon-btn danger" onClick={() => handleDelete('group', group.id, null, group.name)} title="Delete">
                                    <IconTrash />
                                </button>
                            </div>
                        </div>

                        <div className="teams-grid">
                            {group.teams.map(team => (
                                <div key={team.id} className="team-card" onClick={() => handleOpenAssign({ ...team, group_id: group.id })}>
                                    <div className="team-card-header">
                                        <h3>{team.name}</h3>
                                    </div>
                                    <div className="team-stats">
                                        <span>👥 {team.member_count} Members</span>
                                        {team.lunch_time > 0 && <span className="lunch-stat" title="Team Lunch Time">🕒 {team.lunch_time}m</span>}
                                        <span className={`visibility-dot ${team.is_visible ? 'visible' : 'hidden'}`} />
                                    </div>
                                    <div className="managers-list">
                                        {team.managers.map((m, i) => (
                                            <span key={i} className="manager-badge">👤 {m.manager_name}</span>
                                        ))}
                                    </div>
                                    <div className="team-card-actions" onClick={e => e.stopPropagation()}>
                                        <button className="icon-btn history" onClick={() => fetchHistory('team', team.id)} title="History">
                                            <IconHistory />
                                        </button>
                                        <button
                                            className={`icon-btn vis ${team.is_visible ? 'active' : 'muted'}`}
                                            onClick={() => handleToggleVisibility('team', team.id, group.id, team.is_visible)}
                                            title={team.is_visible ? 'Hide' : 'Show'}
                                        >
                                            {team.is_visible ? <IconEye /> : <IconEyeOff />}
                                        </button>
                                        <button className="icon-btn edit" onClick={() => {
                                            setEditingItem({ type: 'team', group_id: group.id, ...team, managers: team.managers.map(m => m.manager_name) });
                                            setShowOrgModal(true);
                                        }} title="Edit">
                                            <IconEdit />
                                        </button>
                                        <button className="icon-btn danger" onClick={() => handleDelete('team', team.id, group.id, team.name)} title="Delete">
                                            <IconTrash />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {group.teams.length === 0 && (
                                <div className="empty-teams-state" style={{ 
                                    padding: '24px', 
                                    textAlign: 'center', 
                                    display: 'flex', 
                                    flexDirection: 'column', 
                                    alignItems: 'center', 
                                    gap: '12px',
                                    background: 'var(--surface-alt)',
                                    borderRadius: '12px',
                                    border: '1px dashed var(--border-color)',
                                    gridColumn: '1 / -1'
                                }}>
                                    <p className="text-muted" style={{ fontSize: '0.9rem', margin: 0 }}>
                                        No teams in this group yet.
                                    </p>
                                    <button 
                                        className="btn-primary" 
                                        style={{ 
                                            background: '#4f46e5', 
                                            fontSize: '0.85rem', 
                                            padding: '8px 16px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px'
                                        }} 
                                        onClick={() => {
                                            setEditingItem({ type: 'team', name: '', group_id: group.id, managers: [] });
                                            setShowOrgModal(true);
                                        }}
                                    >
                                        <span>+</span> New Team
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* ── MODAL: Create / Edit Group or Team ── */}
            {showOrgModal && editingItem && (
                <div className="modal-overlay">
                    <form className="modal-content" onSubmit={handleSaveOrg}>
                        <div className="modal-header">
                            <h2>{editingItem.id ? 'Edit' : 'Create'} {editingItem.type === 'group' ? 'Group' : 'Team'}</h2>
                            <button type="button" className="icon-btn" onClick={() => setShowOrgModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Name</label>
                                <input
                                    type="text"
                                    value={editingItem.name}
                                    onChange={e => setEditingItem({ ...editingItem, name: e.target.value })}
                                    placeholder="e.g. Sales, Marketing..."
                                    required
                                />
                            </div>
                            {editingItem.type === 'team' && (
                                <div className="form-group">
                                    <label>Parent Group</label>
                                    <select
                                        value={editingItem.group_id}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val === 'CREATE_NEW_GROUP') {
                                                setEditingItem({ type: 'group', name: '', managers: [] });
                                            } else {
                                                const numericVal = Number(val);
                                                setEditingItem({ 
                                                    ...editingItem, 
                                                    group_id: isNaN(numericVal) ? val : numericVal 
                                                });
                                            }
                                        }}
                                    >
                                        {hierarchy.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                        <option value="CREATE_NEW_GROUP" style={{ fontWeight: 'bold', color: 'var(--accent-color)' }}>+ Create new Group</option>
                                    </select>
                                </div>
                            )}
                            <div className="form-group">
                                <label>Managers</label>
                                <div className="selected-managers">
                                    {editingItem.managers.map((m, i) => (
                                        <span key={i} className="manager-token">
                                            👤 {m}
                                            <span 
                                                className="remove-manager" 
                                                onClick={() => {
                                                    setEditingItem({
                                                        ...editingItem,
                                                        managers: editingItem.managers.filter(name => name !== m)
                                                    });
                                                }}
                                            >✕</span>
                                        </span>
                                    ))}
                                </div>
                                <div className="manager-search-wrapper">
                                    <input
                                        type="text"
                                        value={managerSearchTerm}
                                        onChange={e => setManagerSearchTerm(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key !== 'Enter') return;
                                            // Enter would otherwise submit the form and drop the typed name
                                            e.preventDefault();
                                            addManager(managerSearchTerm);
                                        }}
                                        placeholder="Search or type a manager name..."
                                    />
                                    {managerSearchTerm && (
                                        <div className="manager-dropdown">
                                            {managerMatches
                                                .slice(0, 8) // Limit results for better performance
                                                .map(emp => (
                                                    <div
                                                        key={emp.employee_id}
                                                        className="manager-option"
                                                        onClick={() => addManager(emp.name)}
                                                    >
                                                        {emp.name}
                                                    </div>
                                                ))
                                            }
                                            {managerMatches.length === 0 && (
                                                <div className="no-results">No employees found matching "{managerSearchTerm}"</div>
                                            )}
                                            {managerQuery && !editingItem.managers.includes(managerQuery) && (
                                                <div
                                                    className="manager-option manager-option-add"
                                                    onClick={() => addManager(managerSearchTerm)}
                                                >
                                                    + Add "{managerQuery}"
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button type="button" onClick={() => setShowOrgModal(false)}>Cancel</button>
                            <button type="submit" className="btn-primary">Save Changes</button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── MODAL: Member Assignment ── */}
            {showAssignModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                {assignPage === 'holidays' && (
                                    <button
                                        className="icon-btn"
                                        onClick={() => setAssignPage('members')}
                                        title="Back to members"
                                    >
                                        <IconChevronLeft />
                                    </button>
                                )}
                                <div>
                                    <h2>{assignPage === 'holidays' ? 'Holidays' : 'Assign Members'}</h2>
                                    <p className="text-muted" style={{ margin: 0 }}>Team: {selectedTeam?.name}</p>
                                </div>
                            </div>
                            <div className="header-right-group">
                                {assignPage === 'members' && (
                                    <div className="bulk-selection-links">
                                        <span className="selection-link" onClick={handleSelectAll}>Select All</span>
                                        <span className="sep">|</span>
                                        <span className="selection-link" onClick={handleDeselectAll}>Deselect All</span>
                                    </div>
                                )}
                                <button className="icon-btn" onClick={() => setShowAssignModal(false)} title="Close">✕</button>
                            </div>
                        </div>

                        {assignPage === 'members' ? (
                            <div className="modal-body">
                                <div className="team-lunch-config" style={assignConfigBoxStyle}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <label style={{ fontWeight: '600', fontSize: '0.95rem' }}>Team Lunch Time</label>
                                        <span className="text-muted" style={{ fontSize: '0.85rem' }}>Set daily lunch duration for the entire team</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <input
                                            type="number"
                                            min="0"
                                            max="120"
                                            value={lunchTime}
                                            onChange={e => setLunchTime(parseInt(e.target.value) || 0)}
                                            style={{
                                                width: '80px',
                                                padding: '8px',
                                                textAlign: 'center',
                                                borderRadius: '6px',
                                                border: '1px solid var(--border-color)',
                                                fontWeight: 'bold'
                                            }}
                                        />
                                        <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>mins</span>
                                    </div>
                                </div>

                                {/* Same box as Team Lunch Time above (shared style object), but the
                                    whole row is the control: it opens this modal's Holidays page. */}
                                <button
                                    type="button"
                                    className="team-holidays-row"
                                    style={assignConfigBoxStyle}
                                    onClick={() => setAssignPage('holidays')}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
                                        <label style={{ fontWeight: '600', fontSize: '0.95rem', cursor: 'inherit' }}>Holidays</label>
                                        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                                            {holidaysLoading
                                                ? 'Loading holiday calendar...'
                                                : holidaysError
                                                    ? holidaysError
                                                    : customizedHolidayCount > 0
                                                        ? `${customizedHolidayCount} holiday${customizedHolidayCount === 1 ? '' : 's'} customized for this team`
                                                        : 'Set how each holiday applies to this team'}
                                        </span>
                                    </div>
                                    <span className="team-holidays-chevron"><IconChevronRight /></span>
                                </button>

                                <input
                                    type="text"
                                    className="assignment-search"
                                    placeholder="Search employees by name..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                                <div className="employee-selection-list">
                                    {allEmployees
                                        .filter(emp => matchesSearch(emp, searchTerm))
                                        .filter(emp => !showOnlySelected || selectedMembers.includes(emp.employee_id))
                                        .map(emp => (
                                            <div
                                                key={emp.employee_id}
                                                className={`employee-select-item ${selectedMembers.includes(emp.employee_id) ? 'selected' : ''}`}
                                                onClick={() => toggleMemberSelection(emp.employee_id)}
                                            >
                                                {emp.name}
                                                {(emp.api_accounts || emp.group_name) && (
                                                    <span className="team-suffix">
                                                        {emp.api_accounts && ` · ${emp.api_accounts}`}
                                                        {emp.group_name && ` · ${emp.group_name}`}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                </div>
                            </div>
                        ) : (
                            <div className="modal-body">
                                <p className="text-muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
                                    The type chosen here applies to <strong>{selectedTeam?.name}</strong> only. Holidays left
                                    on their default follow the organization-wide type set in Scheduling → Holidays.
                                    A Non-Working Holiday removes that day from this team's Run Rate and shows as OFF on the
                                    Schedule Board. Custom keeps the day, and can discount a time window from the team's
                                    scheduled hours without altering the hours DeskTime tracked.
                                </p>

                                <div className="team-holidays-toolbar">
                                    <select
                                        className="team-holidays-year"
                                        value={holidayYear}
                                        onChange={e => setHolidayYear(e.target.value)}
                                    >
                                        <option value="all">All Years</option>
                                        {holidayYears.map(y => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                    <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                                        {visibleHolidays.length} holiday{visibleHolidays.length === 1 ? '' : 's'}
                                    </span>
                                </div>

                                {holidaysLoading ? (
                                    <div className="team-holidays-empty">Loading holidays...</div>
                                ) : holidaysError ? (
                                    <div className="team-holidays-empty">⚠️ {holidaysError}</div>
                                ) : visibleHolidays.length === 0 ? (
                                    <div className="team-holidays-empty">
                                        {teamHolidays.length === 0
                                            ? 'No holidays created yet. Add them in Scheduling → Holidays.'
                                            : 'No holidays in the selected year.'}
                                    </div>
                                ) : (
                                    <div className="team-holidays-list">
                                        {visibleHolidays.map(h => {
                                            const country = getHolidayCountry(h.country_code);
                                            const entry = holidayTypeDraft[h.id] || { type: h.effective_type, from: '', to: '' };
                                            const isCampaign = entry.type === 'campaign_defined';
                                            const hasWindow = isCampaign && entry.from && entry.to;
                                            const isCustom = entry.type !== h.default_type || hasWindow;
                                            const rangeInvalid = invalidHolidayRanges.some(x => x.id === h.id);
                                            const patch = (changes) => setHolidayTypeDraft(prev => ({
                                                ...prev,
                                                [h.id]: { ...(prev[h.id] || {}), ...changes }
                                            }));
                                            return (
                                                <div key={h.id} className="team-holiday-item">
                                                    <div className="team-holiday-row">
                                                        <div className="team-holiday-info">
                                                            <span className="team-holiday-name">
                                                                {h.name}
                                                                {isCustom && <span className="team-holiday-custom">Custom</span>}
                                                            </span>
                                                            <span className="text-muted team-holiday-meta">
                                                                {formatHolidayDate(h.holiday_date)} · <FlagIcon country={country} /> {country.name}
                                                            </span>
                                                        </div>
                                                        <div className="team-holiday-actions">
                                                            <select
                                                                className="team-holiday-select"
                                                                value={entry.type}
                                                                onChange={e => patch({ type: e.target.value })}
                                                            >
                                                                {HOLIDAY_TYPES.map(t => (
                                                                    <option key={t.id} value={t.id}>{t.label}</option>
                                                                ))}
                                                            </select>
                                                            <button
                                                                type="button"
                                                                className="team-holiday-reset"
                                                                disabled={!isCustom}
                                                                onClick={() => patch({ type: h.default_type, from: '', to: '' })}
                                                                title={isCustom ? 'Revert to the organization default' : 'Already using the organization default'}
                                                            >
                                                                Reset
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {isCampaign && (
                                                        <div className={`team-holiday-window ${rangeInvalid ? 'is-invalid' : ''}`}>
                                                            <label>From <span className="team-holiday-required">*</span></label>
                                                            <input
                                                                type="time"
                                                                required
                                                                value={entry.from || ''}
                                                                onChange={e => patch({ from: e.target.value })}
                                                            />
                                                            <label>To <span className="team-holiday-required">*</span></label>
                                                            <input
                                                                type="time"
                                                                required
                                                                value={entry.to || ''}
                                                                onChange={e => patch({ to: e.target.value })}
                                                            />
                                                            <span className={`team-holiday-window-hint ${rangeInvalid ? 'is-invalid' : ''}`}>
                                                                {rangeInvalid
                                                                    ? (hasWindow
                                                                        ? 'The end time must be later than the start time.'
                                                                        : (entry.from || entry.to)
                                                                            ? 'Set both times.'
                                                                            : 'Required — Custom needs a time window.')
                                                                    : hasWindow
                                                                        ? 'Discounted from this team’s scheduled hours. Tracked hours stay as they are.'
                                                                        : 'Inherited from the organization default — set a window to apply it to this team.'}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="modal-footer">
                            {assignPage === 'members' ? (
                                <button
                                    type="button"
                                    className={showOnlySelected ? 'btn-primary' : ''}
                                    style={{ marginRight: 'auto' }}
                                    onClick={() => setShowOnlySelected(prev => !prev)}
                                    title={showOnlySelected ? 'Showing only selected — click to show everyone' : 'Click to show only selected employees'}
                                >
                                    {selectedMembers.length} Selected
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    style={{ marginRight: 'auto' }}
                                    onClick={() => setAssignPage('members')}
                                >
                                    ← Back to Members
                                </button>
                            )}
                            <button onClick={() => setShowAssignModal(false)}>Cancel</button>
                            <button
                                className="btn-primary"
                                onClick={handleSaveAssignments}
                                disabled={invalidHolidayRanges.length > 0}
                                title={invalidHolidayRanges.length > 0
                                    ? 'Fix the Campaign Defined time window before saving'
                                    : undefined}
                            >
                                Update Team
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── MODAL: History ── */}
            {showHistoryModal && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '500px' }}>
                        <div className="modal-header">
                            <h2>Update History</h2>
                            <button className="icon-btn" onClick={() => setShowHistoryModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {history.map(item => (
                                <div key={item.id} className="history-item">
                                    <div className="history-meta">
                                        <span className="history-action">{item.action}</span>
                                        <span>{new Date(item.created_at).toLocaleString()}</span>
                                    </div>
                                    <div className="history-details">{item.details}</div>
                                </div>
                            ))}
                            {history.length === 0 && <p>No history found for this item.</p>}
                        </div>
                    </div>
                </div>
            )}

            {/* ── MODAL: Import from DeskTime ── */}
            {showImportModal && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: '560px' }}>
                        <div className="modal-header">
                            <div>
                                <h2>Import from DeskTime</h2>
                                <p className="text-muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                                    Select DeskTime groups to import as Groups in your organization.
                                </p>
                            </div>
                            <button className="icon-btn" onClick={() => setShowImportModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {importResult ? (
                                <div className="import-result">
                                    <div className="import-result-icon">✅</div>
                                    <h3>Import Complete</h3>
                                    <div className="import-stats">
                                        <div className="import-stat">
                                            <span className="import-stat-num">{importResult.created}</span>
                                            <span>Groups Created</span>
                                        </div>
                                        <div className="import-stat">
                                            <span className="import-stat-num">{importResult.skipped}</span>
                                            <span>Already Existed</span>
                                        </div>
                                        {autoAssign && (
                                            <div className="import-stat">
                                                <span className="import-stat-num">{importResult.assigned}</span>
                                                <span>Employees Assigned</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="import-group-list">
                                        {dtGroups.map(g => (
                                            <div
                                                key={g.group_name}
                                                className={`import-group-item ${selectedImport.includes(g.group_name) ? 'selected' : ''} ${g.already_imported ? 'already-imported' : ''}`}
                                                onClick={() => !g.already_imported && toggleImportSelection(g.group_name)}
                                            >
                                                <div className="import-group-name">
                                                    {g.already_imported && <span className="import-badge">✓ Imported</span>}
                                                    {g.group_name}
                                                </div>
                                                <div className="import-group-count">👥 {g.employee_count} employees</div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="import-option">
                                        <label className="toggle-visibility" style={{ cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={autoAssign}
                                                onChange={e => setAutoAssign(e.target.checked)}
                                            />
                                            <span>
                                                <strong>Auto-assign employees</strong> — automatically create a default Team inside each Group and assign its DeskTime members to it
                                            </span>
                                        </label>
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="modal-footer">
                            {importResult ? (
                                <button className="btn-primary" onClick={() => setShowImportModal(false)}>Done</button>
                            ) : (
                                <>
                                    <span style={{ marginRight: 'auto', fontSize: '0.9rem' }}>
                                        {selectedImport.length} group{selectedImport.length !== 1 ? 's' : ''} selected
                                    </span>
                                    <button onClick={() => setShowImportModal(false)}>Cancel</button>
                                    <button
                                        className="btn-primary"
                                        onClick={handleRunImport}
                                        disabled={importing || selectedImport.length === 0}
                                    >
                                        {importing ? 'Importing...' : 'Import Selected'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Teams;
