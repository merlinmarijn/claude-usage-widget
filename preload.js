const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Multi-account management
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  getActiveAccountId: () => ipcRenderer.invoke('get-active-account-id'),
  setActiveAccountId: (accountId) => ipcRenderer.invoke('set-active-account-id', accountId),
  addAccount: () => ipcRenderer.invoke('add-account'),
  updateAccountLabel: (id, label) => ipcRenderer.invoke('update-account-label', { id, label }),
  removeAccount: (id) => ipcRenderer.invoke('remove-account', id),
  reloginAccount: (accountId) => ipcRenderer.invoke('relogin-account', accountId),
  fetchUsageDataForAccount: (accountId) => ipcRenderer.invoke('fetch-usage-data-for-account', accountId),

  // Legacy credentials management (for backward compatibility)
  getCredentials: () => ipcRenderer.invoke('get-credentials'),
  saveCredentials: (credentials) => ipcRenderer.invoke('save-credentials', credentials),
  deleteCredentials: () => ipcRenderer.invoke('delete-credentials'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  openLogin: (accountId) => ipcRenderer.send('open-login', accountId),

  // Window position
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  setWindowPosition: (position) => ipcRenderer.invoke('set-window-position', position),

  // Event listeners
  onAccountLoginSuccess: (callback) => {
    ipcRenderer.on('account-login-success', (event, data) => callback(data));
  },
  onLoginSuccess: (callback) => {
    // Legacy - now maps to account-login-success
    ipcRenderer.on('account-login-success', (event, data) => callback(data));
  },
  onRefreshUsage: (callback) => {
    ipcRenderer.on('refresh-usage', () => callback());
  },
  onSessionExpired: (callback) => {
    ipcRenderer.on('session-expired', (event, data) => callback(data));
  },
  onSilentLoginStarted: (callback) => {
    ipcRenderer.on('silent-login-started', (event, data) => callback(data));
  },
  onSilentLoginFailed: (callback) => {
    ipcRenderer.on('silent-login-failed', (event, data) => callback(data));
  },

  // API
  fetchUsageData: () => ipcRenderer.invoke('fetch-usage-data'),
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Compact mode
  getCompactMode: () => ipcRenderer.invoke('get-compact-mode'),
  setCompactMode: (isCompact) => ipcRenderer.invoke('set-compact-mode', isCompact),
  expandForSettings: (expand) => ipcRenderer.invoke('expand-for-settings', expand),

  // Refresh interval and update timer settings
  getRefreshInterval: () => ipcRenderer.invoke('get-refresh-interval'),
  setRefreshInterval: (interval) => ipcRenderer.invoke('set-refresh-interval', interval),
  getShowUpdateTimer: () => ipcRenderer.invoke('get-show-update-timer'),
  setShowUpdateTimer: (show) => ipcRenderer.invoke('set-show-update-timer', show)
});
