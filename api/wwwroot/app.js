// ---- State ----
const rooms = {};
let activeOverrides = {}; // key: "room:DEVICE" -> overrideInfo
let overrideTickTimer = null;
let currentHomeId = null;
let connection = null;
let token = localStorage.getItem('jwt');
let userEmail = localStorage.getItem('userEmail');

// ---- DOM Refs ----
const authOverlay = document.getElementById('authOverlay');
const authTitle = document.getElementById('authTitle');
const authSubtitle = document.getElementById('authSubtitle');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmit = document.getElementById('authSubmit');
const authToggle = document.getElementById('authToggle');
const authError = document.getElementById('authError');

const appSection = document.getElementById('appSection');
const homesListView = document.getElementById('homesListView');
const homeDetailView = document.getElementById('homeDetailView');
const homesGrid = document.getElementById('homesGrid');
const currentHomeTitle = document.getElementById('currentHomeTitle');
const backToHomesBtn = document.getElementById('backToHomesBtn');
const toastContainer = document.getElementById('toastContainer');

const userEmailSpan = document.getElementById('userEmailSpan');
const logoutBtn = document.getElementById('logoutBtn');

const addHomeModal = document.getElementById('addHomeModal');
const openAddHomeModalBtn = document.getElementById('openAddHomeModalBtn');
const closeAddHomeModalBtn = document.getElementById('closeAddHomeModalBtn');

const newHomeNameInput = document.getElementById('newHomeNameInput');
const newHomeInput = document.getElementById('newHomeInput');
const addHomeBtn = document.getElementById('addHomeBtn');

const connectionBadge = document.getElementById('connectionBadge');
const connectionText = document.getElementById('connectionText');
const roomGrid = document.getElementById('roomGrid');

const logContainer = document.getElementById('logContainer');
const clearLogsBtn = document.getElementById('clearLogsBtn');

let isLoginMode = true;

async function apiFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers });
    return res;
}

// ---- UI Helpers (Toasts) ----
function showToast(message, type = 'info') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconClass = 'fa-solid fa-circle-info';
    if (type === 'error') iconClass = 'fa-solid fa-circle-xmark';
    if (type === 'success') iconClass = 'fa-solid fa-circle-check';

    toast.innerHTML = `<i class="${iconClass}"></i> <span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ---- Auth ----
function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.add('visible');
}

function hideAuthError() {
    authError.classList.remove('visible');
}

function setAuthMode(login) {
    isLoginMode = login;
    authTitle.textContent = login ? 'Welcome Back' : 'Create Account';
    authSubtitle.textContent = login ? 'Sign in to your dashboard' : 'Register a new account';
    authSubmit.textContent = login ? 'Sign In' : 'Register';
    authToggle.innerHTML = login
        ? "Don't have an account? <a id=\"authToggleLink\">Register</a>"
        : 'Already have an account? <a id="authToggleLink">Sign In</a>';
    document.getElementById('authToggleLink').addEventListener('click', () => setAuthMode(!login));
    hideAuthError();
}

async function handleAuth() {
    const email = authEmail.value.trim();
    const password = authPassword.value;

    if (!email || !password) { showAuthError('Email and password are required'); return; }

    const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showAuthError(err.error || (res.status === 401 ? 'Invalid email or password' : 'Something went wrong'));
            return;
        }

        const data = await res.json();
        token = data.token;
        userEmail = data.email;
        localStorage.setItem('jwt', token);
        localStorage.setItem('userEmail', userEmail);
        enterApp();
    } catch (e) {
        showAuthError('Could not connect to server');
    }
}

function logout() {
    token = null;
    userEmail = null;
    currentHomeId = null;
    localStorage.removeItem('jwt');
    localStorage.removeItem('userEmail');
    if (connection) { connection.stop(); connection = null; }
    for (const k in rooms) delete rooms[k];
    authOverlay.classList.remove('hidden');
    appSection.style.display = 'none';
    authEmail.value = '';
    authPassword.value = '';
    setAuthMode(true);
}

async function enterApp() {
    authOverlay.classList.add('hidden');
    appSection.style.display = '';
    userEmailSpan.textContent = userEmail;
    await showHomesList();
}

async function showHomesList() {
    homesListView.style.display = 'block';
    homeDetailView.style.display = 'none';
    if (connection) { connection.stop(); connection = null; }
    currentHomeId = null;
    await loadHomes();
}

async function showHomeDetails(homeId, homeName) {
    currentHomeId = homeId;
    currentHomeTitle.innerHTML = `${homeName} <span class="id-pill" style="margin-left: 0.5rem;"><i class="fa-solid fa-fingerprint"></i> ${homeId}</span>`;
    homesListView.style.display = 'none';
    homeDetailView.style.display = 'block';

    // Clear old data
    for (const k in rooms) delete rooms[k];
    roomGrid.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-house-circle-exclamation"></i></div><p>No rooms found in ${homeName}</p></div>`;
    if (logContainer) logContainer.innerHTML = '<div class="log-message system">Connecting to home...</div>';

    await connectToHome();
}

async function loadHomes() {
    try {
        const res = await apiFetch('/api/homes');
        if (res.status === 401) { logout(); return; }
        const homes = await res.json();

        homesGrid.innerHTML = '';
        if (homes.length === 0) {
            homesGrid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><div class="empty-icon"><i class="fa-solid fa-satellite-dish"></i></div><p>Add a home ID to get started</p></div>`;
            return;
        }

        homes.forEach(h => {
            const card = document.createElement('div');
            card.className = 'home-card-item';
            card.innerHTML = `
                <h3>${h.name}</h3>
                <div class="id-pill"><i class="fa-solid fa-fingerprint"></i> ${h.homeId}</div>
                <i class="fa-solid fa-house home-card-icon"></i>
            `;
            card.addEventListener('click', () => showHomeDetails(h.homeId, h.name));
            homesGrid.appendChild(card);
        });
    } catch (e) {
        console.error('Failed to load homes:', e);
        showToast('Failed to load homes', 'error');
    }
}

async function addHome() {
    const homeName = newHomeNameInput.value.trim();
    const homeId = newHomeInput.value.trim();

    if (!homeName) { showToast('Please enter a name for the home', 'error'); return; }
    if (!homeId) { showToast('Please enter a Home ID', 'error'); return; }

    const res = await apiFetch('/api/homes', {
        method: 'POST',
        body: JSON.stringify({ homeId: homeId, name: homeName })
    });

    if (res.status === 409) {
        showToast('This home is already registered by another user', 'error');
        return;
    }
    if (!res.ok) {
        showToast('Failed to add home', 'error');
        return;
    }

    newHomeNameInput.value = '';
    newHomeInput.value = '';
    addHomeModal.classList.add('hidden');
    showToast(`Home ${homeName} added successfully!`, 'success');
    await loadHomes();
}

// ---- Rendering ----
function formatTime(utcStr) {
    if (!utcStr) return '—';
    const d = new Date(utcStr);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function doorBadge(s) { s = (s || 'CLOSED').toUpperCase(); return `<span class="badge ${s === 'OPEN' ? 'badge-open' : 'badge-closed'}">${s}</span>`; }
function lightBadge(s) { s = (s || 'OFF').toUpperCase(); return `<span class="badge ${s === 'ON' ? 'badge-on' : 'badge-off'}">${s}</span>`; }
function fanBadge(s) { s = (s || 'OFF').toUpperCase(); return `<span class="badge ${s === 'ON' ? 'badge-on' : 'badge-off'}">${s}</span>`; }
function smokeBadge(d) { return d ? '<span class="badge badge-detected"><i class="fa-solid fa-triangle-exclamation"></i> DETECTED</span>' : '<span class="badge badge-safe"><i class="fa-solid fa-shield-halved"></i> Safe</span>'; }
function motionBadge(d) { return d ? '<span class="badge badge-motion"><i class="fa-solid fa-person-running"></i> Motion</span>' : '<span class="badge badge-no-motion">No motion</span>'; }

function toggleState(current, onVal, offVal) {
    return (current || offVal).toUpperCase() === onVal ? offVal : onVal;
}

async function controlDevice(room, device, state) {
    if (!connection || connection.state !== 'Connected') { showToast('Not connected', 'error'); return; }
    try {
        await connection.invoke('ControlDevice', currentHomeId, room, device, state);
    } catch (e) {
        console.error('Control failed:', e);
        showToast('Control failed', 'error');
    }
}

async function removeOverride(room, device) {
    if (!connection || connection.state !== 'Connected') return;
    try {
        await connection.invoke('RemoveOverride', currentHomeId, room, device);
    } catch (e) { console.error('Remove override failed:', e); }
}

function handleOverrideState(overrideList) {
    activeOverrides = {};
    if (Array.isArray(overrideList)) {
        overrideList.forEach(o => {
            const room = o.room || o.Room;
            const device = o.device || o.Device;
            const remaining = o.remainingSeconds !== undefined ? o.remainingSeconds : o.RemainingSeconds;
            if (room && device) {
                activeOverrides[`${room}:${device}`] = { ...o, remainingSeconds: remaining };
            }
        });
    }
    Object.values(rooms).forEach(rs => renderRoom(rs));

    // Start local countdown tick if not already running
    if (!overrideTickTimer) {
        overrideTickTimer = setInterval(tickOverrides, 1000);
    }
}

function tickOverrides() {
    let needsFullRender = false;
    for (const key in activeOverrides) {
        if (activeOverrides[key].remainingSeconds > 0) {
            activeOverrides[key].remainingSeconds--;

            // Update the UI directly without destroying the whole room card
            const parts = key.split(':');
            const badge = document.getElementById(`override-${parts[0]}-${parts[1]}`);
            if (badge) {
                badge.innerHTML = `⏸ ${formatRemaining(activeOverrides[key].remainingSeconds)}`;
            }
        } else {
            // Once it hits 0, remove it locally. 
            // The backend automation resumes naturally, and next snapshot will confirm.
            delete activeOverrides[key];
            needsFullRender = true;
        }
    }
    if (needsFullRender) {
        Object.values(rooms).forEach(rs => renderRoom(rs));
    }
}

function formatRemaining(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function overrideBadge(room, device) {
    const o = activeOverrides[`${room}:${device}`];
    if (!o) return '';
    return `<div class="override-float" id="override-${room}-${device}" onclick="removeOverride('${room}', '${device}')" title="Click to resume Auto">⏸ ${formatRemaining(o.remainingSeconds)}</div>`;
}

function renderRoom(rs) {
    const id = `room-${rs.room}`;
    let card = document.getElementById(id);
    const isNew = !card;
    if (isNew) { card = document.createElement('div'); card.id = id; }
    card.className = `room-card${rs.smokeDetected ? ' smoke-alert' : ''}`;

    const lightOn = (rs.lightState || 'OFF').toUpperCase() === 'ON';
    const fanOn = (rs.fanState || 'OFF').toUpperCase() === 'ON';
    const doorOpen = (rs.doorState || 'CLOSED').toUpperCase() === 'OPEN';

    const tempText = rs.temperature != null ? rs.temperature.toFixed(1) + '°C' : '—';
    const luxText = rs.lightLevel != null ? Math.round(rs.lightLevel) + ' lux' : '—';

    card.innerHTML = `
        <div class="room-stats">
            <div class="stat"><i class="fa-solid fa-temperature-half" style="color: var(--accent-teal);"></i> ${tempText}</div>
        </div>
        <div class="room-name-title">${rs.room}</div>
        <div class="room-timestamp">${formatTime(rs.lastUpdated)}</div>
        
        <div class="room-main-control">
            ${overrideBadge(rs.room, 'LIGHT')}
            <button class="circle-btn main-light-btn ${lightOn ? 'active' : ''}" onclick="controlDevice('${rs.room}', 'light', '${lightOn ? 'OFF' : 'ON'}')">
                <i class="fa-solid fa-lightbulb"></i>
                <div class="main-light-lux">${luxText}</div>
            </button>
        </div>
        
        <div class="room-sub-controls">
            <div style="position: relative;">
                ${overrideBadge(rs.room, 'FAN')}
                <button class="sub-btn ${fanOn ? 'active' : ''}" onclick="controlDevice('${rs.room}', 'fan', '${fanOn ? 'OFF' : 'ON'}')">
                    <i class="fa-solid fa-fan ${fanOn ? 'spin-anim' : ''}"></i>
                </button>
            </div>
            
            <div style="position: relative;">
                ${overrideBadge(rs.room, 'DOOR')}
                <button class="sub-btn ${doorOpen ? 'active' : ''}" onclick="controlDevice('${rs.room}', 'door', '${doorOpen ? 'CLOSED' : 'OPEN'}')">
                    <i class="fa-solid ${doorOpen ? 'fa-door-open' : 'fa-door-closed'}"></i>
                </button>
            </div>
            
            <div class="status-icon motion ${rs.motionDetected ? 'active' : ''}" title="Motion">
                <i class="fa-solid fa-person-rays"></i>
            </div>
            
            <div class="status-icon danger ${rs.smokeDetected ? 'active' : ''}" title="Smoke">
                <i class="fa-solid fa-fire-flame-curved"></i>
            </div>
        </div>
    `;

    if (isNew) {
        const empty = roomGrid.querySelector('.empty-state');
        if (empty) empty.remove();
        roomGrid.appendChild(card);
    }
}

function flashRow(room, type) {
    const el = document.getElementById(`room-${room}-${type}`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
}

// ---- SignalR ----
function setConnectionStatus(status) {
    connectionBadge.className = `connection-badge ${status}`;
    const labels = { connected: 'Connected', error: 'Disconnected', '': 'Connecting...' };
    connectionText.textContent = labels[status] || 'Connecting...';
}

async function connectToHome() {
    if (connection) { try { await connection.stop(); } catch { } }
    for (const k in rooms) delete rooms[k];
    roomGrid.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-satellite-dish"></i></div><p>Connecting to home...</p></div>`;
    setConnectionStatus('');

    connection = new signalR.HubConnectionBuilder()
        .withUrl('/hub/home', { accessTokenFactory: () => token })
        .withAutomaticReconnect([0, 1000, 2000, 5000, 10000])
        .build();

    connection.on('HomeSnapshot', (homeId, snapshot) => {
        if (homeId !== currentHomeId) return;
        if (snapshot && snapshot.length > 0) {
            snapshot.forEach(rs => { rooms[rs.room] = rs; renderRoom(rs); });
        } else {
            roomGrid.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-house-circle-exclamation"></i></div><p>Connected, waiting for sensor data...</p></div>`;
        }
    });

    connection.on('OverrideState', handleOverrideState);

    connection.on('SensorUpdated', (homeId, rs) => {
        if (homeId !== currentHomeId) return;
        const prev = rooms[rs.room];
        rooms[rs.room] = rs;
        renderRoom(rs);
        if (prev) {
            if (prev.temperature !== rs.temperature) flashRow(rs.room, 'temp');
            if (prev.lightLevel !== rs.lightLevel) flashRow(rs.room, 'lux');
            if (prev.doorState !== rs.doorState) flashRow(rs.room, 'door');
            if (prev.lightState !== rs.lightState) flashRow(rs.room, 'light');
            if (prev.fanState !== rs.fanState) flashRow(rs.room, 'fan');
            if (prev.motionDetected !== rs.motionDetected) flashRow(rs.room, 'motion');
            if (prev.smokeDetected !== rs.smokeDetected) flashRow(rs.room, 'smoke');
        }
    });

    connection.on('SystemLog', (message) => {
        addLogMessage(message, 'auto');
    });

    connection.on('Error', (msg) => { console.error('Hub error:', msg); });
    connection.onreconnecting(() => setConnectionStatus(''));
    connection.onreconnected(() => { setConnectionStatus('connected'); connection.invoke('JoinHome', currentHomeId); });
    connection.onclose(() => {
        setConnectionStatus('error');
        if (overrideTickTimer) { clearInterval(overrideTickTimer); overrideTickTimer = null; }
    });

    try {
        await connection.start();
        setConnectionStatus('connected');
        await connection.invoke('JoinHome', currentHomeId);
    } catch (err) {
        console.error('SignalR failed:', err);
        setConnectionStatus('error');
    }
}

authSubmit.addEventListener('click', handleAuth);
authPassword.addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
logoutBtn.addEventListener('click', logout);

openAddHomeModalBtn.addEventListener('click', () => {
    newHomeNameInput.value = '';
    newHomeInput.value = '';
    addHomeModal.classList.remove('hidden');
    newHomeNameInput.focus();
});
closeAddHomeModalBtn.addEventListener('click', () => addHomeModal.classList.add('hidden'));

addHomeBtn.addEventListener('click', addHome);
newHomeInput.addEventListener('keydown', e => { if (e.key === 'Enter') addHome(); });
backToHomesBtn.addEventListener('click', showHomesList);
clearLogsBtn.addEventListener('click', () => { if (logContainer) logContainer.innerHTML = ''; });

function addLogMessage(text, type = 'system') {
    if (!logContainer) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `log-message ${type}`;
    const time = new Date().toLocaleTimeString([], { hour12: false });
    msgDiv.innerHTML = `<span class="time">${time}</span>${text}`;
    logContainer.appendChild(msgDiv);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// ---- Init ----
setAuthMode(true);
if (token && userEmail) {
    enterApp();
} else {
    appSection.style.display = 'none';
}
