# Portable Vite+PHP Architecture Definition

This document defines the software architecture used in this project, designed for **extreme portability** and ease of deployment.

## 1. Core Concept
The core of this architecture is the **"Unified Dist"** pattern. 
Instead of maintaining separate frontend and backend deployments, we bundle the entire application—frontend assets and backend PHP scripts—into a single static folder (`dist`) that can be dropped onto any standard Apache/PHP server (LAMP stack).

## 2. Directory Structure & Organization

To achieve this, the project is organized as follows:

```
project-root/
├── src/                  # React Frontend Code
│   ├── components/
│   ├── pages/
│   └── App.jsx
│
├── public/               # Backend & Static Assets
│   ├── api/              # PHP Backend API (Isolated)
│   │   ├── auth.php
│   │   └── db_config.php 
│   ├── .htaccess         # Apache Routing Rules
│   └── vite.svg          # Images/Icons
│
├── vite.config.js        # Build Configuration
└── package.json          # Dependencies
```

### The Role of `public/`
In Vite, files located in the `public/` directory are **copied directly to the root of the build output (`dist/`)**. 
*   **We leverage this** by placing our backend PHP scripts inside `public/api/`.
*   When compiled, the `dist/` folder contains both the optimized React bundle AND the executable PHP scripts side-by-side.

## 3. Configuration Requirements

### A. Vite Base Path (`vite.config.js`)
To ensure the app runs correctly in **any** folder (e.g., `http://server/app/` or `http://server/test/`), we set the base path to relative (`./`):

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base allows the app to work in any subfolder without rebuilding
  base: './', 
})
```

### B. Relative API Calls
The frontend MUST communicate with the backend using **relative paths**. 

**Correct:**
```javascript
fetch('./api/auth.php', { method: 'POST' ... })
```

**Incorrect:**
```javascript
fetch('http://localhost/api/auth.php', ...)
fetch('/api/auth.php', ...) // This breaks if app is in a subfolder
```

## 4. Deployment Workflow

1.  **Build**: Run the build command to generate the portable artifact.
    ```bash
    npm run build
    ```
    This creates a `dist` folder.

2.  **Deploy**: Copy the **contents** of the `dist` folder to your web server.
    *   **Destination:** `/var/www/html/any-folder-name/`
    *   No Node.js server is required.
    *   Apache serves `index.html` for the UI and executes `.php` files for the API.

## 5. Benefits
*   **Zero-Config Deployment**: If the server has Apache and PHP, the app runs immediately.
*   **Truly Portable**: You can rename the folder on the server, and the app will still work.
*   **Performance**: The frontend is served as static pre-compressed assets.

## 6. Routing (SPA Behavior)
To prevent 404s when refreshing pages in a Single Page Application (SPA), use this generic `.htaccess` file in `public/`:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  # Don't hardcode RewriteBase. Let it detect the current folder.
  
  # Allow access to existing files (API, assets, images)
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]

  # Route everything else to index.html
  RewriteRule ^ index.html [L]
</IfModule>
```
