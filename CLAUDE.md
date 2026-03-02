# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Usage Widget is a Windows desktop widget built with Electron that displays Claude.ai usage statistics in real-time. It shows session (5-hour) and weekly (7-day) usage limits with progress bars and countdown timers.

## Commands

```bash
# Install dependencies
npm install

# Run in development mode (opens DevTools)
npm run dev

# Run in production mode
npm start

# Build Windows installer (outputs to dist/)
npm run build:win
```

## Architecture

### Process Model (Electron)

The app follows Electron's multi-process architecture:

- **Main Process** (`main.js`): Handles window management, system tray, IPC handlers, credential storage (electron-store), and API calls to Claude.ai
- **Preload** (`preload.js`): Exposes a secure `electronAPI` bridge to the renderer via `contextBridge`
- **Renderer** (`src/renderer/`): UI code with `app.js` managing state, `index.html` for structure, and `styles.css` for styling

### Authentication Flow

1. Widget checks for stored credentials (sessionKey + organizationId) on startup
2. If missing, prompts user to login via `claude.ai` in a modal BrowserWindow
3. After login, polls for `sessionKey` cookie and fetches organization ID from `/api/organizations`
4. On session expiry (401/403), attempts silent re-login using existing OAuth session before showing login prompt

### API Integration

- **Usage endpoint**: `https://claude.ai/api/organizations/{org_id}/usage`
- Returns `five_hour` (session) and `seven_day` (weekly) utilization data with reset timestamps
- Auto-refreshes every 5 minutes (`UPDATE_INTERVAL` in `app.js`)

### IPC Channels

Key channels between main and renderer:
- `get-credentials` / `save-credentials` / `delete-credentials`: Credential management
- `fetch-usage-data`: Proxies API calls through main process (required for cookie handling)
- `login-success`: Notifies renderer when login completes
- `silent-login-started` / `silent-login-failed`: Auto-login status updates

### Storage

- Credentials stored via `electron-store` at `%APPDATA%/claude-usage-widget/config.json`
- Window position persisted and restored on startup
