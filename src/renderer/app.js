// Application state
let accounts = [];
let activeAccountId = null;
let usageDataByAccount = {}; // Map of account ID to usage data
let updateInterval = null;
let countdownInterval = null;
let updateTimerInterval = null;
let refreshIntervalMs = 5 * 60 * 1000; // Default 5 minutes
let showUpdateTimer = false;
let nextUpdateTime = null;

// DOM elements
const elements = {
    loadingContainer: document.getElementById('loadingContainer'),
    loginContainer: document.getElementById('loginContainer'),
    noUsageContainer: document.getElementById('noUsageContainer'),
    autoLoginContainer: document.getElementById('autoLoginContainer'),
    mainContent: document.getElementById('mainContent'),
    loginBtn: document.getElementById('loginBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    minimizeBtn: document.getElementById('minimizeBtn'),
    closeBtn: document.getElementById('closeBtn'),

    // Account tabs
    accountTabsContainer: document.getElementById('accountTabsContainer'),

    sessionPercentage: document.getElementById('sessionPercentage'),
    sessionProgress: document.getElementById('sessionProgress'),
    sessionTimer: document.getElementById('sessionTimer'),
    sessionTimeText: document.getElementById('sessionTimeText'),

    weeklyPercentage: document.getElementById('weeklyPercentage'),
    weeklyProgress: document.getElementById('weeklyProgress'),
    weeklyTimer: document.getElementById('weeklyTimer'),
    weeklyTimeText: document.getElementById('weeklyTimeText'),

    settingsBtn: document.getElementById('settingsBtn'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    coffeeBtn: document.getElementById('coffeeBtn'),
    compactModeToggle: document.getElementById('compactModeToggle'),

    // Compact mode controls
    compactSettingsBtn: document.getElementById('compactSettingsBtn'),
    compactMinimizeBtn: document.getElementById('compactMinimizeBtn'),
    compactCloseBtn: document.getElementById('compactCloseBtn'),

    // New settings
    refreshIntervalSelect: document.getElementById('refreshIntervalSelect'),
    showUpdateTimerToggle: document.getElementById('showUpdateTimerToggle'),

    // Update timer displays
    updateTimerNormal: document.getElementById('updateTimerNormal'),
    updateTimerText: document.getElementById('updateTimerText'),
    updateTimerCompact: document.getElementById('updateTimerCompact'),

    // Accounts section in settings
    accountsList: document.getElementById('accountsList'),
    addAccountBtn: document.getElementById('addAccountBtn')
};

// Initialize
async function init() {
    setupEventListeners();

    // Load and apply compact mode setting
    const isCompactMode = await window.electronAPI.getCompactMode();
    applyCompactMode(isCompactMode);
    elements.compactModeToggle.checked = isCompactMode;

    // Load refresh interval setting
    refreshIntervalMs = await window.electronAPI.getRefreshInterval();
    elements.refreshIntervalSelect.value = refreshIntervalMs.toString();

    // Load show update timer setting
    showUpdateTimer = await window.electronAPI.getShowUpdateTimer();
    elements.showUpdateTimerToggle.checked = showUpdateTimer;
    applyUpdateTimerVisibility();

    // Load accounts
    accounts = await window.electronAPI.getAccounts();
    activeAccountId = await window.electronAPI.getActiveAccountId();

    // If no active account but we have accounts, set the first one as active
    if (!activeAccountId && accounts.length > 0) {
        activeAccountId = accounts[0].id;
        await window.electronAPI.setActiveAccountId(activeAccountId);
    }

    if (accounts.length > 0 && activeAccountId) {
        renderAccountTabs();
        showMainContent();
        await fetchUsageData();
        startAutoUpdate();
    } else {
        showLoginRequired();
    }
}

// Get active account
function getActiveAccount() {
    return accounts.find(a => a.id === activeAccountId) || accounts[0];
}

// Render account tabs
function renderAccountTabs() {
    if (!elements.accountTabsContainer) return;

    let tabsHtml = '';

    accounts.forEach(account => {
        const isActive = account.id === activeAccountId;
        tabsHtml += `
            <button class="account-tab ${isActive ? 'active' : ''}"
                    data-account-id="${account.id}"
                    title="${account.label}">
                ${account.label}
            </button>
        `;
    });

    // Add "+" button to add new account
    tabsHtml += `
        <button class="account-tab add-tab" id="addAccountTabBtn" title="Add Account">+</button>
    `;

    elements.accountTabsContainer.innerHTML = tabsHtml;

    // Add event listeners to tabs
    elements.accountTabsContainer.querySelectorAll('.account-tab:not(.add-tab)').forEach(tab => {
        tab.addEventListener('click', () => {
            const accountId = tab.dataset.accountId;
            switchAccount(accountId);
        });
    });

    // Add event listener to add button
    const addBtn = document.getElementById('addAccountTabBtn');
    if (addBtn) {
        addBtn.addEventListener('click', handleAddAccount);
    }
}

// Switch active account
async function switchAccount(accountId) {
    if (accountId === activeAccountId) return;

    activeAccountId = accountId;
    await window.electronAPI.setActiveAccountId(accountId);

    // Update tab UI
    renderAccountTabs();

    // Check if we have cached usage data for this account
    const cachedData = usageDataByAccount[accountId];
    if (cachedData) {
        updateUI(cachedData);
    } else {
        // Fetch data for this account
        await fetchUsageData();
    }
}

// Render accounts list in settings
function renderAccountsList() {
    if (!elements.accountsList) return;

    let listHtml = '';

    accounts.forEach(account => {
        listHtml += `
            <div class="account-item" data-account-id="${account.id}">
                <span class="account-label-display">${account.label}</span>
                <input type="text" class="account-label-input" value="${account.label}" style="display: none;">
                <div class="account-actions">
                    <button class="account-edit-btn" title="Edit name">✏️</button>
                    <button class="account-remove-btn" title="Remove account">🗑️</button>
                </div>
            </div>
        `;
    });

    elements.accountsList.innerHTML = listHtml;

    // Add event listeners
    elements.accountsList.querySelectorAll('.account-item').forEach(item => {
        const accountId = item.dataset.accountId;
        const editBtn = item.querySelector('.account-edit-btn');
        const removeBtn = item.querySelector('.account-remove-btn');
        const labelDisplay = item.querySelector('.account-label-display');
        const labelInput = item.querySelector('.account-label-input');

        editBtn.addEventListener('click', () => {
            // Toggle edit mode
            const isEditing = labelInput.style.display !== 'none';
            if (isEditing) {
                // Save
                handleSaveLabel(accountId, labelInput.value);
                labelDisplay.textContent = labelInput.value;
                labelDisplay.style.display = 'inline';
                labelInput.style.display = 'none';
                editBtn.textContent = '✏️';
            } else {
                // Enter edit mode
                labelDisplay.style.display = 'none';
                labelInput.style.display = 'inline';
                labelInput.focus();
                labelInput.select();
                editBtn.textContent = '✓';
            }
        });

        // Save on Enter key
        labelInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleSaveLabel(accountId, labelInput.value);
                labelDisplay.textContent = labelInput.value;
                labelDisplay.style.display = 'inline';
                labelInput.style.display = 'none';
                editBtn.textContent = '✏️';
            } else if (e.key === 'Escape') {
                labelInput.value = labelDisplay.textContent;
                labelDisplay.style.display = 'inline';
                labelInput.style.display = 'none';
                editBtn.textContent = '✏️';
            }
        });

        removeBtn.addEventListener('click', () => {
            handleRemoveAccount(accountId);
        });
    });
}

// Handle add account
async function handleAddAccount() {
    await window.electronAPI.addAccount();
}

// Handle save label
async function handleSaveLabel(accountId, newLabel) {
    await window.electronAPI.updateAccountLabel(accountId, newLabel);

    // Update local state
    const account = accounts.find(a => a.id === accountId);
    if (account) {
        account.label = newLabel;
    }

    // Update tabs
    renderAccountTabs();
}

// Handle remove account
async function handleRemoveAccount(accountId) {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    const confirmed = confirm(`Remove "${account.label}"? This cannot be undone.`);
    if (!confirmed) return;

    const result = await window.electronAPI.removeAccount(accountId);

    if (result.success) {
        // Update local state
        accounts = accounts.filter(a => a.id !== accountId);
        delete usageDataByAccount[accountId];

        if (accounts.length === 0) {
            // No accounts left, show login
            activeAccountId = null;
            showLoginRequired();
        } else if (result.newActiveId) {
            // Switch to new active account
            activeAccountId = result.newActiveId;
            renderAccountTabs();
            renderAccountsList();
            await fetchUsageData();
        }
    }
}

// Apply compact mode styling
function applyCompactMode(isCompact) {
    if (isCompact) {
        document.body.classList.add('compact-mode');
    } else {
        document.body.classList.remove('compact-mode');
    }
}

// Settings management (handles window expansion)
async function openSettings() {
    console.log('[Renderer] Opening settings...');
    await window.electronAPI.expandForSettings(true);
    renderAccountsList();
    elements.settingsOverlay.style.display = 'flex';
}

async function closeSettings() {
    console.log('[Renderer] Closing settings...');
    elements.settingsOverlay.style.display = 'none';
    await window.electronAPI.expandForSettings(false);
    console.log('[Renderer] Settings closed, window should be resized');
}

// Update timer visibility
function applyUpdateTimerVisibility() {
    if (showUpdateTimer) {
        elements.updateTimerNormal.style.display = 'flex';
        elements.updateTimerCompact.style.display = 'inline';
    } else {
        elements.updateTimerNormal.style.display = 'none';
        elements.updateTimerCompact.style.display = 'none';
    }
}

// Update timer countdown
function updateTimerCountdown() {
    if (!showUpdateTimer || !nextUpdateTime) return;

    const now = Date.now();
    const remaining = Math.max(0, nextUpdateTime - now);
    const seconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    const timeStr = `${minutes}:${secs.toString().padStart(2, '0')}`;
    elements.updateTimerText.textContent = `Next update in ${timeStr}`;
    elements.updateTimerCompact.textContent = `⟳ ${timeStr}`;
}

function startUpdateTimerCountdown() {
    if (updateTimerInterval) clearInterval(updateTimerInterval);
    nextUpdateTime = Date.now() + refreshIntervalMs;
    updateTimerCountdown();
    updateTimerInterval = setInterval(updateTimerCountdown, 1000);
}

function stopUpdateTimerCountdown() {
    if (updateTimerInterval) {
        clearInterval(updateTimerInterval);
        updateTimerInterval = null;
    }
}

// Event Listeners
function setupEventListeners() {
    elements.loginBtn.addEventListener('click', () => {
        window.electronAPI.openLogin();
    });

    elements.refreshBtn.addEventListener('click', async () => {
        console.log('Refresh button clicked');
        elements.refreshBtn.classList.add('spinning');
        await fetchUsageData();
        elements.refreshBtn.classList.remove('spinning');
    });

    elements.minimizeBtn.addEventListener('click', () => {
        window.electronAPI.minimizeWindow();
    });

    elements.closeBtn.addEventListener('click', () => {
        window.electronAPI.closeWindow(); // Exit application completely
    });

    // Settings calls
    elements.settingsBtn.addEventListener('click', async () => {
        await openSettings();
    });

    elements.closeSettingsBtn.addEventListener('click', async () => {
        await closeSettings();
    });

    elements.logoutBtn.addEventListener('click', async () => {
        await window.electronAPI.deleteCredentials();
        accounts = [];
        activeAccountId = null;
        usageDataByAccount = {};
        await closeSettings();
        showLoginRequired();
    });

    elements.coffeeBtn.addEventListener('click', () => {
        window.electronAPI.openExternal('https://paypal.me/SlavomirDurej?country.x=GB&locale.x=en_GB');
    });

    // Compact mode toggle
    elements.compactModeToggle.addEventListener('change', async (e) => {
        const isCompact = e.target.checked;
        await window.electronAPI.setCompactMode(isCompact);
        applyCompactMode(isCompact);
    });

    // Refresh interval setting
    elements.refreshIntervalSelect.addEventListener('change', async (e) => {
        refreshIntervalMs = parseInt(e.target.value, 10);
        await window.electronAPI.setRefreshInterval(refreshIntervalMs);
        // Restart auto-update with new interval
        if (updateInterval) {
            startAutoUpdate();
        }
    });

    // Show update timer toggle
    elements.showUpdateTimerToggle.addEventListener('change', async (e) => {
        showUpdateTimer = e.target.checked;
        await window.electronAPI.setShowUpdateTimer(showUpdateTimer);
        applyUpdateTimerVisibility();
    });

    // Compact mode control buttons
    elements.compactSettingsBtn.addEventListener('click', async () => {
        await openSettings();
    });

    elements.compactMinimizeBtn.addEventListener('click', () => {
        window.electronAPI.minimizeWindow();
    });

    elements.compactCloseBtn.addEventListener('click', () => {
        window.electronAPI.closeWindow();
    });

    // Add account button in settings
    if (elements.addAccountBtn) {
        elements.addAccountBtn.addEventListener('click', handleAddAccount);
    }

    // Listen for account login success
    window.electronAPI.onAccountLoginSuccess(async (data) => {
        console.log('Renderer received account-login-success event', data);

        // Reload accounts from store
        accounts = await window.electronAPI.getAccounts();

        if (data.isNew && data.account) {
            // New account was added, switch to it
            activeAccountId = data.account.id;
            await window.electronAPI.setActiveAccountId(activeAccountId);
        } else if (data.account) {
            // Existing account was refreshed
            const index = accounts.findIndex(a => a.id === data.account.id);
            if (index >= 0) {
                accounts[index] = data.account;
            }
        }

        renderAccountTabs();
        renderAccountsList();
        showMainContent();
        await fetchUsageData();
        startAutoUpdate();
    });

    // Listen for refresh requests from tray
    window.electronAPI.onRefreshUsage(async () => {
        await fetchUsageData();
    });

    // Listen for session expiration events (403 errors) - only used as fallback
    window.electronAPI.onSessionExpired((data) => {
        console.log('Session expired event received', data);
        // The main process handles re-login attempts
    });

    // Listen for silent login attempts
    window.electronAPI.onSilentLoginStarted((data) => {
        console.log('Silent login started...', data);
        showAutoLoginAttempt();
    });

    // Listen for silent login failures (falls back to visible login)
    window.electronAPI.onSilentLoginFailed((data) => {
        console.log('Silent login failed, manual login required', data);
        showLoginRequired();
    });
}

// Fetch usage data from Claude API
async function fetchUsageData() {
    const account = getActiveAccount();

    if (!account || !account.sessionKey || !account.organizationId) {
        console.log('Missing credentials for active account, showing login');
        showLoginRequired();
        return;
    }

    try {
        console.log('Calling electronAPI.fetchUsageDataForAccount...', account.id);
        const data = await window.electronAPI.fetchUsageDataForAccount(account.id);
        console.log('Received usage data:', data);

        // Cache the data
        usageDataByAccount[account.id] = data;

        updateUI(data);
    } catch (error) {
        console.error('Error fetching usage data:', error);
        if (error.message.includes('SessionExpired') || error.message.includes('Unauthorized')) {
            // Session expired - silent login attempt is in progress
            // Show auto-login UI while waiting
            showAutoLoginAttempt();
        } else {
            showError('Failed to fetch usage data');
        }
    }
}

// Check if there's no usage data
function hasNoUsage(data) {
    const sessionUtilization = data.five_hour?.utilization || 0;
    const sessionResetsAt = data.five_hour?.resets_at;
    const weeklyUtilization = data.seven_day?.utilization || 0;
    const weeklyResetsAt = data.seven_day?.resets_at;

    return sessionUtilization === 0 && !sessionResetsAt &&
        weeklyUtilization === 0 && !weeklyResetsAt;
}

// Update UI with usage data
function updateUI(data) {
    // Check if there's no usage data
    if (hasNoUsage(data)) {
        showNoUsage();
        return;
    }

    showMainContent();
    refreshTimers(data);
    startCountdown();
}

// Track if we've already triggered a refresh for expired timers
let sessionResetTriggered = false;
let weeklyResetTriggered = false;

function refreshTimers(data) {
    if (!data) {
        data = usageDataByAccount[activeAccountId];
    }
    if (!data) return;

    // Session data
    const sessionUtilization = data.five_hour?.utilization || 0;
    const sessionResetsAt = data.five_hour?.resets_at;

    // Check if session timer has expired and we need to refresh
    if (sessionResetsAt) {
        const sessionDiff = new Date(sessionResetsAt) - new Date();
        if (sessionDiff <= 0 && !sessionResetTriggered) {
            sessionResetTriggered = true;
            console.log('Session timer expired, triggering refresh...');
            // Wait a few seconds for the server to update, then refresh
            setTimeout(() => {
                fetchUsageData();
            }, 3000);
        } else if (sessionDiff > 0) {
            sessionResetTriggered = false; // Reset flag when timer is active again
        }
    }

    updateProgressBar(
        elements.sessionProgress,
        elements.sessionPercentage,
        sessionUtilization
    );

    updateTimer(
        elements.sessionTimer,
        elements.sessionTimeText,
        sessionResetsAt,
        5 * 60 // 5 hours in minutes
    );

    // Weekly data
    const weeklyUtilization = data.seven_day?.utilization || 0;
    const weeklyResetsAt = data.seven_day?.resets_at;

    // Check if weekly timer has expired and we need to refresh
    if (weeklyResetsAt) {
        const weeklyDiff = new Date(weeklyResetsAt) - new Date();
        if (weeklyDiff <= 0 && !weeklyResetTriggered) {
            weeklyResetTriggered = true;
            console.log('Weekly timer expired, triggering refresh...');
            setTimeout(() => {
                fetchUsageData();
            }, 3000);
        } else if (weeklyDiff > 0) {
            weeklyResetTriggered = false;
        }
    }

    updateProgressBar(
        elements.weeklyProgress,
        elements.weeklyPercentage,
        weeklyUtilization,
        true
    );

    updateTimer(
        elements.weeklyTimer,
        elements.weeklyTimeText,
        weeklyResetsAt,
        7 * 24 * 60 // 7 days in minutes
    );
}

function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        refreshTimers();
    }, 1000);
}

// Update progress bar
function updateProgressBar(progressElement, percentageElement, value, isWeekly = false) {
    const percentage = Math.min(Math.max(value, 0), 100);

    progressElement.style.width = `${percentage}%`;
    percentageElement.textContent = `${Math.round(percentage)}%`;

    // Update color based on usage level
    progressElement.classList.remove('warning', 'danger');
    if (percentage >= 90) {
        progressElement.classList.add('danger');
    } else if (percentage >= 75) {
        progressElement.classList.add('warning');
    }
}

// Update circular timer
function updateTimer(timerElement, textElement, resetsAt, totalMinutes) {
    if (!resetsAt) {
        textElement.textContent = '--:--';
        textElement.style.opacity = '0.5';
        textElement.title = 'Starts when a message is sent';
        timerElement.style.strokeDashoffset = 63;
        return;
    }

    // Clear the greyed out styling and tooltip when timer is active
    textElement.style.opacity = '1';
    textElement.title = '';

    const resetDate = new Date(resetsAt);
    const now = new Date();
    const diff = resetDate - now;

    if (diff <= 0) {
        textElement.textContent = 'Resetting...';
        timerElement.style.strokeDashoffset = 0;
        return;
    }

    // Calculate remaining time
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    // const seconds = Math.floor((diff % (1000 * 60)) / 1000); // Optional seconds

    // Format time display
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        textElement.textContent = `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
        textElement.textContent = `${hours}h ${minutes}m`;
    } else {
        textElement.textContent = `${minutes}m`;
    }

    // Calculate progress (elapsed percentage)
    const totalMs = totalMinutes * 60 * 1000;
    const elapsedMs = totalMs - diff;
    const elapsedPercentage = (elapsedMs / totalMs) * 100;

    // Update circle (63 is ~2*pi*10)
    const circumference = 63;
    const offset = circumference - (elapsedPercentage / 100) * circumference;
    timerElement.style.strokeDashoffset = offset;

    // Update color based on remaining time
    timerElement.classList.remove('warning', 'danger');
    if (elapsedPercentage >= 90) {
        timerElement.classList.add('danger');
    } else if (elapsedPercentage >= 75) {
        timerElement.classList.add('warning');
    }
}

// UI State Management
function showLoading() {
    elements.loadingContainer.style.display = 'block';
    elements.loginContainer.style.display = 'none';
    elements.noUsageContainer.style.display = 'none';
    elements.autoLoginContainer.style.display = 'none';
    elements.mainContent.style.display = 'none';
    if (elements.accountTabsContainer) elements.accountTabsContainer.style.display = 'none';
}

function showLoginRequired() {
    elements.loadingContainer.style.display = 'none';
    elements.loginContainer.style.display = 'flex'; // Use flex to preserve centering
    elements.noUsageContainer.style.display = 'none';
    elements.autoLoginContainer.style.display = 'none';
    elements.mainContent.style.display = 'none';
    if (elements.accountTabsContainer) elements.accountTabsContainer.style.display = 'none';
    stopAutoUpdate();
}

function showNoUsage() {
    elements.loadingContainer.style.display = 'none';
    elements.loginContainer.style.display = 'none';
    elements.noUsageContainer.style.display = 'flex';
    elements.autoLoginContainer.style.display = 'none';
    elements.mainContent.style.display = 'none';
    if (elements.accountTabsContainer) elements.accountTabsContainer.style.display = 'flex';
}

function showAutoLoginAttempt() {
    elements.loadingContainer.style.display = 'none';
    elements.loginContainer.style.display = 'none';
    elements.noUsageContainer.style.display = 'none';
    elements.autoLoginContainer.style.display = 'flex';
    elements.mainContent.style.display = 'none';
    if (elements.accountTabsContainer) elements.accountTabsContainer.style.display = 'none';
    stopAutoUpdate();
}

function showMainContent() {
    elements.loadingContainer.style.display = 'none';
    elements.loginContainer.style.display = 'none';
    elements.noUsageContainer.style.display = 'none';
    elements.autoLoginContainer.style.display = 'none';
    elements.mainContent.style.display = 'block';
    if (elements.accountTabsContainer) elements.accountTabsContainer.style.display = 'flex';
}

function showError(message) {
    // TODO: Implement error notification
    console.error(message);
}

// Auto-update management
function startAutoUpdate() {
    stopAutoUpdate();
    startUpdateTimerCountdown();
    updateInterval = setInterval(() => {
        fetchUsageData();
        startUpdateTimerCountdown(); // Reset countdown after each fetch
    }, refreshIntervalMs);
}

function stopAutoUpdate() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    stopUpdateTimerCountdown();
}

// Add spinning animation for refresh button
const style = document.createElement('style');
style.textContent = `
    @keyframes spin-refresh {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .refresh-btn.spinning svg {
        animation: spin-refresh 1s linear;
    }
`;
document.head.appendChild(style);

// Start the application
init();

// Cleanup on unload
window.addEventListener('beforeunload', () => {
    stopAutoUpdate();
    if (countdownInterval) clearInterval(countdownInterval);
});
