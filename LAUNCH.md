# Workforce Platform - Launch Instructions

## Prerequisites
1.  **Node.js**: Required to build the frontend.
2.  **PHP Environment**: Required to run the backend API.
    *   **Windows**: Install [XAMPP](https://www.apachefriends.org/) or similar.
    *   Ensure `php` is in your system PATH or you know the path to `php.exe`.

## 1. Development Mode (Localhost)
To develop with live reloading (Hot Module Replacement) and working PHP API:

### Step A: Install Dependencies
Run this once to install the Javascript libraries:
```bash
npm install
```

### Step B: Start the Servers
You need TWO terminals running simultaneously:

**Terminal 1: PHP Backend**
This serves the API files from `public/api`.
```bash
# Option 1: Using the built-in script (requires XAMPP default path)
npm run dev:php

# Option 2: Manually pointing to your PHP executable
"C:\path\to\php.exe" -S localhost:8000 -t public
```
*The backend will run at http://localhost:8000*

**Terminal 2: React Frontend**
This runs the UI with proxy configured to talk to port 8000.
```bash
npm run dev
```
*The frontend will run at http://localhost:5173 (or 5174)*

---

## 2. Production Deployment (Portable)
This architecture allows you to deploy to ANY standard shared hosting or Apache server without Node.js.

### Step A: Build
Generate the production files:
```bash
npm run build
```
This creates a `dist` folder containing:
*   `index.html`
*   `assets/` (Compiled JS/CSS)
*   `api/` (Your PHP backend scripts copied automatically)
*   `.htaccess` (Routing rules)

### Step B: Deploy
1.  Copy the **contents** of the `dist` folder to your server (e.g., via FTP or cPanel).
2.  That's it!
    *   No Node.js required on the server.
    *   Works in subfolders (e.g., `example.com/my-app/`).
    *   The `.htaccess` handles the routing.

## Troubleshooting
*   **"Backend Offline"**: Ensure the PHP server is running on port 8000.
*   **CORS Errors**: In development, the `proxy` in `vite.config.js` handles this. In production, the files are on the same domain, so CORS is not an issue.
