import { useState, useEffect } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

// Placeholder Menu Data
const MENU_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '📊',
    submenu: []
  },
  {
    id: 'employees',
    label: 'Employees',
    icon: '👥',
    submenu: [
      { id: 'all-emp', label: 'All Employees' },
      { id: 'add-emp', label: 'Add New' },
      { id: 'teams', label: 'Teams' }
    ]
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: '📈',
    submenu: [
      { id: 'reports', label: 'Reports' },
      { id: 'kpi', label: 'KPIs' },
      { id: 'export', label: 'Export Data' }
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '⚙️',
    submenu: [
      { id: 'profile', label: 'Profile' },
      { id: 'security', label: 'Security' }
    ]
  }
]

function App() {
  const [theme, setTheme] = useState('light')
  const [activeMenu, setActiveMenu] = useState(null)
  const [backendStatus, setBackendStatus] = useState('Checking backend...')

  // Initialize Theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'light'
    setTheme(savedTheme)
    document.documentElement.className = savedTheme
  }, [])

  // Toggle Theme
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    document.documentElement.className = newTheme
  }

  // Backend Check
  useEffect(() => {
    fetch('./api/auth.php')
      .then(res => res.json())
      .then(data => setBackendStatus(data.message || 'Connected'))
      .catch(() => setBackendStatus('Backend Offline'))
  }, [])

  return (
    <div className={`app-container ${theme}`}>

      {/* SIDEBAR */}
      <aside className="sidebar">

        {/* LOGO SECTION */}
        <div className="logo-section" onClick={() => window.location.reload()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <img src={viteLogo} alt="Logo" width="40" />
            <span style={{ fontWeight: 'bold', fontSize: '1.2em' }}>Workforce</span>
          </div>
        </div>

        {/* MENU LIST */}
        <div className="menu-list" style={{ marginTop: '20px' }}>
          {MENU_ITEMS.map((item) => (
            <div
              key={item.id}
              className="menu-item"
              onMouseEnter={() => setActiveMenu(item.id)}
              onMouseLeave={() => setActiveMenu(null)}
            >
              <div className="menu-item-header">
                <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {item.icon} {item.label}
                </span>
                {item.submenu.length > 0 && <span style={{ fontSize: '0.8em', opacity: 0.6 }}>▼</span>}
              </div>

              {/* SUBMENU (Rendered if items exist) */}
              {item.submenu.length > 0 && (
                <div
                  className="submenu"
                  style={{ display: activeMenu === item.id ? 'block' : 'none' }}
                >
                  {item.submenu.map(sub => (
                    <div key={sub.id} className="submenu-item">
                      {sub.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* CONFIG / THEME TOGGLE */}
        <div className="config-section">
          <div className="theme-toggle" onClick={toggleTheme}>
            <span>Mode: {theme === 'light' ? 'Light ☀️' : 'Dark 🌙'}</span>
          </div>
          <div style={{ marginTop: '10px', fontSize: '0.8em', color: '#888', textAlign: 'center' }}>
            API: {backendStatus}
          </div>
        </div>

      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        <header style={{ marginBottom: '2rem' }}>
          <h1>Welcome to Workforce Platform</h1>
          <p>Select an item from the sidebar to get started.</p>
        </header>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
          <div className="card" style={{ padding: '20px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            <h3>Recent Activity</h3>
            <p>No recent updates.</p>
          </div>
          <div className="card" style={{ padding: '20px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            <h3>Quick Stats</h3>
            <p>Users: 0</p>
          </div>
          <div className="card" style={{ padding: '20px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            <h3>System Status</h3>
            <p>All systems operational.</p>
          </div>
        </section>

      </main>
    </div>
  )
}

export default App
