import { useState, useEffect } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)
  const [backendStatus, setBackendStatus] = useState('Checking backend...')
  const [serverTime, setServerTime] = useState(null)

  useEffect(() => {
    // Note: This fetch will fail in pure npm run dev unless proxied or running dist on Apache
    // For dev, we might mock this or set a proxy
    fetch('./api/auth.php')
      .then(res => {
        if (!res.ok) throw new Error('API fetch failed')
        return res.json()
      })
      .then(data => {
        setBackendStatus(data.message || 'Connected')
        setServerTime(data.server_time)
      })
      .catch(err => {
        console.error(err)
        setBackendStatus('Backend API not reachable (Are you running on Apache/PHP?)')
      })
  }, [])

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React + PHP</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.jsx</code> and save to test HMR
        </p>
        <div style={{ marginTop: '20px', padding: '10px', border: '1px solid #ddd' }}>
          <h3>Backend Status:</h3>
          <p>{backendStatus}</p>
          {serverTime && <p>Server Time: {serverTime}</p>}
        </div>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
