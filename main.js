const { app, BrowserWindow, ipcMain, Tray, Menu, session, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const axios = require('axios');

const store = new Store({
  encryptionKey: 'claude-widget-secure-key-2024'
});

let mainWindow = null;
let loginWindow = null;
let silentLoginWindow = null;
let tray = null;
let pendingLoginAccountId = null; // Track which account is being logged in

// Window configuration
const WIDGET_WIDTH = 480;
const WIDGET_HEIGHT = 170; // Increased to accommodate account tabs
const WIDGET_HEIGHT_WITH_TIMER = 190;
const COMPACT_WIDTH = 370;
const COMPACT_HEIGHT = 110; // Increased for account tabs
const SETTINGS_WIDTH = 480;
const SETTINGS_HEIGHT = 500; // Increased for accounts section

// Generate unique ID for accounts
function generateAccountId() {
  return 'acc_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Migrate from old single-account format to new multi-account format
function migrateToMultiAccount() {
  const existingSessionKey = store.get('sessionKey');
  const existingOrgId = store.get('organizationId');
  const existingAccounts = store.get('accounts');

  // Already migrated
  if (existingAccounts) {
    return;
  }

  // Has old format credentials - migrate
  if (existingSessionKey && existingOrgId) {
    const accounts = [{
      id: generateAccountId(),
      label: 'Account 1',
      sessionKey: existingSessionKey,
      organizationId: existingOrgId
    }];
    store.set('accounts', accounts);
    store.set('activeAccountId', accounts[0].id);
    store.delete('sessionKey');
    store.delete('organizationId');
    console.log('[Main] Migrated single account to multi-account format');
  } else {
    // No credentials at all - initialize empty accounts array
    store.set('accounts', []);
  }
}

function createMainWindow() {
  // Load saved position and compact mode setting
  const savedPosition = store.get('windowPosition');
  const isCompactMode = store.get('compactMode', false);
  const showUpdateTimer = store.get('showUpdateTimer', false);

  // Calculate height based on mode and timer visibility
  let windowHeight;
  if (isCompactMode) {
    windowHeight = COMPACT_HEIGHT;
  } else {
    windowHeight = showUpdateTimer ? WIDGET_HEIGHT_WITH_TIMER : WIDGET_HEIGHT;
  }

  const windowOptions = {
    width: isCompactMode ? COMPACT_WIDTH : WIDGET_WIDTH,
    height: windowHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    icon: path.join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  };

  // Apply saved position if it exists
  if (savedPosition) {
    windowOptions.x = savedPosition.x;
    windowOptions.y = savedPosition.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile('src/renderer/index.html');

  // Make window draggable
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true);

  // Save position when window is moved
  mainWindow.on('move', () => {
    const position = mainWindow.getBounds();
    store.set('windowPosition', { x: position.x, y: position.y });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Development tools
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// accountId: optional - if provided, updates that account; if null, creates a new account
function createLoginWindow(accountId = null) {
  pendingLoginAccountId = accountId;

  // Each account needs its own isolated session partition to prevent cookie collisions
  // - Existing accounts: use persistent partition tied to account ID
  // - New accounts: use a temporary partition for the login flow
  const sessionPartition = accountId
    ? `persist:account-${accountId}`
    : `persist:newaccount-${Date.now()}`;
  const loginSession = session.fromPartition(sessionPartition);

  loginWindow = new BrowserWindow({
    width: 800,
    height: 700,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      session: loginSession
    }
  });

  loginWindow.loadURL('https://claude.ai');

  let loginCheckInterval = null;
  let hasLoggedIn = false;

  // Function to check login status
  async function checkLoginStatus() {
    if (hasLoggedIn || !loginWindow) return;

    try {
      // Use the login window's session to get cookies
      const cookies = await loginSession.cookies.get({
        url: 'https://claude.ai',
        name: 'sessionKey'
      });

      if (cookies.length > 0) {
        const sessionKey = cookies[0].value;
        console.log('Session key found, attempting to get org ID...');

        // Fetch org ID from API
        let orgId = null;
        try {
          const response = await axios.get('https://claude.ai/api/organizations', {
            headers: {
              'Cookie': `sessionKey=${sessionKey}`,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });

          if (response.data && Array.isArray(response.data) && response.data.length > 0) {
            orgId = response.data[0].uuid || response.data[0].id;
            console.log('Org ID fetched from API:', orgId);
          }
        } catch (err) {
          console.log('API not ready yet:', err.message);
        }

        if (sessionKey && orgId) {
          hasLoggedIn = true;
          if (loginCheckInterval) {
            clearInterval(loginCheckInterval);
            loginCheckInterval = null;
          }

          console.log('Saving account credentials...');

          let accounts = store.get('accounts') || [];
          let account;

          if (pendingLoginAccountId) {
            // Update existing account
            const accountIndex = accounts.findIndex(a => a.id === pendingLoginAccountId);
            if (accountIndex >= 0) {
              accounts[accountIndex].sessionKey = sessionKey;
              accounts[accountIndex].organizationId = orgId;
              account = accounts[accountIndex];
              console.log('Updated existing account:', account.label);
            }
          } else {
            // Create new account
            const newAccountNumber = accounts.length + 1;
            account = {
              id: generateAccountId(),
              label: `Account ${newAccountNumber}`,
              sessionKey: sessionKey,
              organizationId: orgId
            };
            accounts.push(account);
            console.log('Created new account:', account.label);

            // Copy cookies from temp partition to account's permanent partition
            // This enables silent re-login to work for newly created accounts
            const permanentPartition = session.fromPartition(`persist:account-${account.id}`);
            try {
              const allCookies = await loginSession.cookies.get({ url: 'https://claude.ai' });
              for (const cookie of allCookies) {
                await permanentPartition.cookies.set({
                  url: 'https://claude.ai',
                  name: cookie.name,
                  value: cookie.value,
                  domain: cookie.domain,
                  path: cookie.path,
                  secure: cookie.secure,
                  httpOnly: cookie.httpOnly,
                  expirationDate: cookie.expirationDate
                });
              }
              console.log('Copied cookies to permanent partition for account:', account.id);
            } catch (cookieErr) {
              console.error('Failed to copy cookies to permanent partition:', cookieErr);
            }
          }

          store.set('accounts', accounts);

          // Set as active account if it's the first one or if we just created it
          if (!pendingLoginAccountId || accounts.length === 1) {
            store.set('activeAccountId', account.id);
          }

          if (mainWindow) {
            mainWindow.webContents.send('account-login-success', {
              account,
              isNew: !pendingLoginAccountId
            });
            console.log('account-login-success sent');
          } else {
            console.error('mainWindow is null, cannot send account-login-success');
          }

          pendingLoginAccountId = null;
          loginWindow.close();
        }
      }
    } catch (error) {
      console.error('Error in login check:', error);
    }
  }

  // Check on page load
  loginWindow.webContents.on('did-finish-load', async () => {
    const url = loginWindow.webContents.getURL();
    console.log('Login page loaded:', url);

    if (url.includes('claude.ai')) {
      await checkLoginStatus();
    }
  });

  // Also check on navigation (URL changes)
  loginWindow.webContents.on('did-navigate', async (event, url) => {
    console.log('Navigated to:', url);
    if (url.includes('claude.ai')) {
      await checkLoginStatus();
    }
  });

  // Poll periodically in case the session becomes ready without a page navigation
  loginCheckInterval = setInterval(async () => {
    if (!hasLoggedIn && loginWindow) {
      await checkLoginStatus();
    } else if (loginCheckInterval) {
      clearInterval(loginCheckInterval);
      loginCheckInterval = null;
    }
  }, 2000);

  loginWindow.on('closed', () => {
    if (loginCheckInterval) {
      clearInterval(loginCheckInterval);
      loginCheckInterval = null;
    }
    pendingLoginAccountId = null;
    loginWindow = null;
  });
}

// Attempt silent login in a hidden browser window for a specific account
async function attemptSilentLogin(accountId = null) {
  console.log('[Main] Attempting silent login for account:', accountId);

  // Notify renderer that we're trying to auto-login
  if (mainWindow) {
    mainWindow.webContents.send('silent-login-started', { accountId });
  }

  // Use account-specific session partition to prevent cookie collisions between accounts
  const sessionPartition = accountId
    ? `persist:account-${accountId}`
    : `persist:silent-${Date.now()}`;
  const silentSession = session.fromPartition(sessionPartition);

  return new Promise((resolve) => {
    silentLoginWindow = new BrowserWindow({
      width: 800,
      height: 700,
      show: false, // Hidden window
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: silentSession
      }
    });

    silentLoginWindow.loadURL('https://claude.ai');

    let loginCheckInterval = null;
    let hasLoggedIn = false;
    const SILENT_LOGIN_TIMEOUT = 15000; // 15 seconds timeout

    // Function to check login status
    async function checkLoginStatus() {
      if (hasLoggedIn || !silentLoginWindow) return;

      try {
        const cookies = await silentSession.cookies.get({
          url: 'https://claude.ai',
          name: 'sessionKey'
        });

        if (cookies.length > 0) {
          const sessionKey = cookies[0].value;
          console.log('[Main] Silent login: Session key found, attempting to get org ID...');

          // Fetch org ID from API
          let orgId = null;
          try {
            const response = await axios.get('https://claude.ai/api/organizations', {
              headers: {
                'Cookie': `sessionKey=${sessionKey}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });

            if (response.data && Array.isArray(response.data) && response.data.length > 0) {
              orgId = response.data[0].uuid || response.data[0].id;
              console.log('[Main] Silent login: Org ID fetched from API:', orgId);
            }
          } catch (err) {
            console.log('[Main] Silent login: API not ready yet:', err.message);
          }

          if (sessionKey && orgId) {
            hasLoggedIn = true;
            if (loginCheckInterval) {
              clearInterval(loginCheckInterval);
              loginCheckInterval = null;
            }

            console.log('[Main] Silent login successful!');

            // Update the specific account
            let accounts = store.get('accounts') || [];
            let account;

            if (accountId) {
              const accountIndex = accounts.findIndex(a => a.id === accountId);
              if (accountIndex >= 0) {
                accounts[accountIndex].sessionKey = sessionKey;
                accounts[accountIndex].organizationId = orgId;
                account = accounts[accountIndex];
                store.set('accounts', accounts);
              }
            }

            if (mainWindow) {
              mainWindow.webContents.send('account-login-success', {
                account: account || { sessionKey, organizationId: orgId },
                isNew: false,
                isSilent: true
              });
            }

            silentLoginWindow.close();
            resolve(true);
          }
        }
      } catch (error) {
        console.error('[Main] Silent login check error:', error);
      }
    }

    // Check on page load
    silentLoginWindow.webContents.on('did-finish-load', async () => {
      const url = silentLoginWindow.webContents.getURL();
      console.log('[Main] Silent login page loaded:', url);

      if (url.includes('claude.ai')) {
        await checkLoginStatus();
      }
    });

    // Also check on navigation
    silentLoginWindow.webContents.on('did-navigate', async (event, url) => {
      console.log('[Main] Silent login navigated to:', url);
      if (url.includes('claude.ai')) {
        await checkLoginStatus();
      }
    });

    // Poll periodically
    loginCheckInterval = setInterval(async () => {
      if (!hasLoggedIn && silentLoginWindow) {
        await checkLoginStatus();
      } else if (loginCheckInterval) {
        clearInterval(loginCheckInterval);
        loginCheckInterval = null;
      }
    }, 1000);

    // Timeout - if silent login doesn't work, fall back to visible login
    setTimeout(() => {
      if (!hasLoggedIn) {
        console.log('[Main] Silent login timeout, falling back to visible login...');
        if (loginCheckInterval) {
          clearInterval(loginCheckInterval);
          loginCheckInterval = null;
        }
        if (silentLoginWindow) {
          silentLoginWindow.close();
        }

        // Notify renderer that silent login failed
        if (mainWindow) {
          mainWindow.webContents.send('silent-login-failed', { accountId });
        }

        // Open visible login window for the specific account
        createLoginWindow(accountId);
        resolve(false);
      }
    }, SILENT_LOGIN_TIMEOUT);

    silentLoginWindow.on('closed', () => {
      if (loginCheckInterval) {
        clearInterval(loginCheckInterval);
        loginCheckInterval = null;
      }
      silentLoginWindow = null;
    });
  });
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'assets/tray-icon.png'));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Widget',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
          } else {
            createMainWindow();
          }
        }
      },
      {
        label: 'Refresh',
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send('refresh-usage');
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Add Account',
        click: () => {
          createLoginWindow(null);
        }
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          app.quit();
        }
      }
    ]);

    tray.setToolTip('Claude Usage Widget');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
  } catch (error) {
    console.error('Failed to create tray:', error);
  }
}

// IPC Handlers

// Multi-account handlers
ipcMain.handle('get-accounts', () => {
  return store.get('accounts') || [];
});

ipcMain.handle('get-active-account-id', () => {
  return store.get('activeAccountId');
});

ipcMain.handle('set-active-account-id', (event, accountId) => {
  store.set('activeAccountId', accountId);
  return true;
});

ipcMain.handle('add-account', () => {
  // Opens login window to add a new account
  createLoginWindow(null);
  return true;
});

ipcMain.handle('update-account-label', (event, { id, label }) => {
  const accounts = store.get('accounts') || [];
  const accountIndex = accounts.findIndex(a => a.id === id);
  if (accountIndex >= 0) {
    accounts[accountIndex].label = label;
    store.set('accounts', accounts);
    return true;
  }
  return false;
});

ipcMain.handle('remove-account', async (event, id) => {
  let accounts = store.get('accounts') || [];
  const accountIndex = accounts.findIndex(a => a.id === id);

  if (accountIndex >= 0) {
    accounts.splice(accountIndex, 1);
    store.set('accounts', accounts);

    // If we removed the active account, set a new active account
    const activeAccountId = store.get('activeAccountId');
    if (activeAccountId === id) {
      if (accounts.length > 0) {
        store.set('activeAccountId', accounts[0].id);
      } else {
        store.delete('activeAccountId');
      }
    }

    return { success: true, newActiveId: accounts.length > 0 ? store.get('activeAccountId') : null };
  }
  return { success: false };
});

ipcMain.handle('relogin-account', (event, accountId) => {
  createLoginWindow(accountId);
  return true;
});

// Legacy handlers (kept for compatibility during transition)
ipcMain.handle('get-credentials', () => {
  // Return first account credentials for backward compatibility
  const accounts = store.get('accounts') || [];
  if (accounts.length > 0) {
    const activeId = store.get('activeAccountId');
    const account = accounts.find(a => a.id === activeId) || accounts[0];
    return {
      sessionKey: account.sessionKey,
      organizationId: account.organizationId
    };
  }
  return { sessionKey: null, organizationId: null };
});

ipcMain.handle('save-credentials', (event, { sessionKey, organizationId }) => {
  // Update active account credentials
  const accounts = store.get('accounts') || [];
  const activeId = store.get('activeAccountId');
  const accountIndex = accounts.findIndex(a => a.id === activeId);

  if (accountIndex >= 0) {
    accounts[accountIndex].sessionKey = sessionKey;
    accounts[accountIndex].organizationId = organizationId;
    store.set('accounts', accounts);
  }
  return true;
});

ipcMain.handle('delete-credentials', async () => {
  // Remove all accounts and clear cookies
  store.set('accounts', []);
  store.delete('activeAccountId');

  // Clear the session cookie to ensure actual logout
  try {
    await session.defaultSession.cookies.remove('https://claude.ai', 'sessionKey');
  } catch (error) {
    console.error('Failed to clear cookies:', error);
  }

  return true;
});

ipcMain.on('open-login', (event, accountId) => {
  createLoginWindow(accountId || null);
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('close-window', () => {
  app.quit();
});

ipcMain.handle('get-window-position', () => {
  if (mainWindow) {
    return mainWindow.getBounds();
  }
  return null;
});

ipcMain.handle('set-window-position', (event, { x, y }) => {
  if (mainWindow) {
    mainWindow.setPosition(x, y);
    return true;
  }
  return false;
});

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

// Compact mode handlers
ipcMain.handle('get-compact-mode', () => {
  return store.get('compactMode', false);
});

ipcMain.handle('get-refresh-interval', () => {
  return store.get('refreshInterval', 300000); // Default 5 minutes
});

ipcMain.handle('set-refresh-interval', (event, interval) => {
  store.set('refreshInterval', interval);
  return true;
});

ipcMain.handle('get-show-update-timer', () => {
  return store.get('showUpdateTimer', false);
});

ipcMain.handle('set-show-update-timer', (event, show) => {
  store.set('showUpdateTimer', show);
  return true;
});

ipcMain.handle('set-compact-mode', (event, isCompact) => {
  store.set('compactMode', isCompact);
  return true;
});

// Temporarily expand window for settings
ipcMain.handle('expand-for-settings', (event, expand) => {
  if (!mainWindow) return false;

  const bounds = mainWindow.getBounds();
  const isCompactMode = store.get('compactMode', false);
  const showUpdateTimer = store.get('showUpdateTimer', false);

  // Temporarily allow resizing
  mainWindow.setResizable(true);

  if (expand) {
    // Expand to settings size
    mainWindow.setBounds({ x: bounds.x, y: bounds.y, width: SETTINGS_WIDTH, height: SETTINGS_HEIGHT });
    console.log('[Main] Expanded for settings');
  } else {
    // Restore to appropriate size based on compact mode and timer settings
    const targetWidth = isCompactMode ? COMPACT_WIDTH : WIDGET_WIDTH;
    let targetHeight;
    if (isCompactMode) {
      targetHeight = COMPACT_HEIGHT;
    } else {
      targetHeight = showUpdateTimer ? WIDGET_HEIGHT_WITH_TIMER : WIDGET_HEIGHT;
    }
    mainWindow.setBounds({ x: bounds.x, y: bounds.y, width: targetWidth, height: targetHeight });
    console.log('[Main] Restored from settings, compact:', isCompactMode, 'size:', targetWidth, 'x', targetHeight);
  }

  // Disable resizing again
  mainWindow.setResizable(false);

  return true;
});

// Fetch usage data for a specific account by ID
ipcMain.handle('fetch-usage-data-for-account', async (event, accountId) => {
  console.log('[Main] fetch-usage-data-for-account called for:', accountId);

  const accounts = store.get('accounts') || [];
  const account = accounts.find(a => a.id === accountId);

  if (!account) {
    throw new Error('Account not found');
  }

  const { sessionKey, organizationId } = account;

  console.log('[Main] Account credentials:', {
    accountId,
    label: account.label,
    hasSessionKey: !!sessionKey,
    organizationId
  });

  if (!sessionKey || !organizationId) {
    throw new Error('Missing credentials for account');
  }

  try {
    console.log('[Main] Making API request to:', `https://claude.ai/api/organizations/${organizationId}/usage`);
    const response = await axios.get(
      `https://claude.ai/api/organizations/${organizationId}/usage`,
      {
        headers: {
          'Cookie': `sessionKey=${sessionKey}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    console.log('[Main] API request successful, status:', response.status);
    return response.data;
  } catch (error) {
    console.error('[Main] API request failed:', error.message);
    if (error.response) {
      console.error('[Main] Response status:', error.response.status);
      if (error.response.status === 401 || error.response.status === 403) {
        // Session expired for this account - attempt silent re-login
        console.log('[Main] Session expired for account:', account.label);

        // Clear this account's credentials
        const updatedAccounts = store.get('accounts') || [];
        const accountIndex = updatedAccounts.findIndex(a => a.id === accountId);
        if (accountIndex >= 0) {
          updatedAccounts[accountIndex].sessionKey = null;
          updatedAccounts[accountIndex].organizationId = null;
          store.set('accounts', updatedAccounts);
        }

        // Attempt silent login for this specific account
        attemptSilentLogin(accountId);

        throw new Error('SessionExpired:' + accountId);
      }
    }
    throw error;
  }
});

// Legacy fetch-usage-data (uses active account)
ipcMain.handle('fetch-usage-data', async () => {
  console.log('[Main] fetch-usage-data handler called');

  const accounts = store.get('accounts') || [];
  const activeId = store.get('activeAccountId');
  const account = accounts.find(a => a.id === activeId) || accounts[0];

  if (!account) {
    throw new Error('No accounts configured');
  }

  const { sessionKey, organizationId } = account;

  console.log('[Main] Credentials:', {
    hasSessionKey: !!sessionKey,
    organizationId
  });

  if (!sessionKey || !organizationId) {
    throw new Error('Missing credentials');
  }

  try {
    console.log('[Main] Making API request to:', `https://claude.ai/api/organizations/${organizationId}/usage`);
    const response = await axios.get(
      `https://claude.ai/api/organizations/${organizationId}/usage`,
      {
        headers: {
          'Cookie': `sessionKey=${sessionKey}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    console.log('[Main] API request successful, status:', response.status);
    return response.data;
  } catch (error) {
    console.error('[Main] API request failed:', error.message);
    if (error.response) {
      console.error('[Main] Response status:', error.response.status);
      if (error.response.status === 401 || error.response.status === 403) {
        // Session expired - attempt silent re-login
        console.log('[Main] Session expired, attempting silent re-login...');

        // Clear this account's credentials
        const updatedAccounts = store.get('accounts') || [];
        const accountIndex = updatedAccounts.findIndex(a => a.id === account.id);
        if (accountIndex >= 0) {
          updatedAccounts[accountIndex].sessionKey = null;
          updatedAccounts[accountIndex].organizationId = null;
          store.set('accounts', updatedAccounts);
        }

        // Attempt silent login (will notify renderer appropriately)
        attemptSilentLogin(account.id);

        throw new Error('SessionExpired');
      }
    }
    throw error;
  }
});

// App lifecycle
app.whenReady().then(() => {
  // Migrate from old single-account format if needed
  migrateToMultiAccount();

  createMainWindow();
  createTray();

  // Check if we have credentials
  // const hasCredentials = store.get('sessionKey') && store.get('organizationId');
  // if (!hasCredentials) {
  //   setTimeout(() => {
  //     createLoginWindow();
  //   }, 1000);
  // }
});

app.on('window-all-closed', () => {
  // Don't quit on macOS
  if (process.platform !== 'darwin') {
    // Keep running in tray
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
