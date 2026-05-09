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
const userEmailSpan = document.getElementById('userEmailSpan');
const logoutBtn = document.getElementById('logoutBtn');

const homeSelect = document.getElementById('homeSelect');
const newHomeNameInput = document.getElementById('newHomeNameInput');
const newHomeInput = document.getElementById('newHomeInput');
const addHomeBtn = document.getElementById('addHomeBtn');

const connectionBadge = document.getElementById('connectionBadge');
const connectionText = document.getElementById('connectionText');
const roomGrid = document.getElementById('roomGrid');

let isLoginMode = true;

// ---- API Helpers ----
async function apiFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers });
    return res;
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
    await loadHomes();
}

// ---- Home Management ----
async function loadHomes() {
    try {
        const res = await apiFetch('/api/homes');
        if (res.status === 401) { logout(); return; }
        const homes = await res.json();

        homeSelect.innerHTML = '';
        if (homes.length === 0) {
            homeSelect.innerHTML = '<option value="">No homes — add one</option>';
            currentHomeId = null;
            roomGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">🏠</div><p>Add a home ID to get started</p></div>`;
            return;
        }

        homes.forEach(h => {
            const opt = document.createElement('option');
            opt.value = h.homeId;
            opt.textContent = `${h.name} (${h.homeId})`;
            homeSelect.appendChild(opt);
        });

        if (!currentHomeId || !homes.find(h => h.homeId === currentHomeId)) {
            currentHomeId = homes[0].homeId;
        }
        homeSelect.value = currentHomeId;
        await connectToHome();
    } catch (e) {
        console.error('Failed to load homes:', e);
    }
}

async function addHome() {
    const homeName = newHomeNameInput.value.trim();
    const homeId = newHomeInput.value.trim();
    
    if (!homeName) { alert('Please enter a name for the home'); return; }
    if (!homeId) { alert('Please enter a Home ID'); return; }

    const res = await apiFetch('/api/homes', {
        method: 'POST',
        body: JSON.stringify({ homeId: homeId, name: homeName })
    });

    if (res.status === 409) {
        alert('This home is already registered by another user');
        return;
    }
    if (!res.ok) {
        alert('Failed to add home');
        return;
    }

    newHomeNameInput.value = '';
    newHomeInput.value = '';
    currentHomeId = homeId;
    await loadHomes();
}

// ---- Rendering ----
function formatTime(utcStr) {
    if (!utcStr) return '—';
    const d = new Date(utcStr);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function doorBadge(s) { s = (s||'CLOSED').toUpperCase(); return `<span class="badge ${s==='OPEN'?'badge-open':'badge-closed'}">${s}</span>`; }
function lightBadge(s) { s = (s||'OFF').toUpperCase(); return `<span class="badge ${s==='ON'?'badge-on':'badge-off'}">${s}</span>`; }
function fanBadge(s) { s = (s||'OFF').toUpperCase(); return `<span class="badge ${s==='ON'?'badge-on':'badge-off'}">${s}</span>`; }
function smokeBadge(d) { return d ? '<span class="badge badge-detected">🚨 DETECTED</span>' : '<span class="badge badge-safe">Safe</span>'; }
function motionBadge(d) { return d ? '<span class="badge badge-motion">🏃 Motion</span>' : '<span class="badge badge-no-motion">No motion</span>'; }

function toggleState(current, onVal, offVal) {
    return (current || offVal).toUpperCase() === onVal ? offVal : onVal;
}

async function controlDevice(room, device, state) {
    if (!connection || connection.state !== 'Connected') { alert('Not connected'); return; }
    try {
        await connection.invoke('ControlDevice', currentHomeId, room, device, state);
    } catch (e) {
        console.error('Control failed:', e);
        alert('Control failed');
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
                badge.innerHTML = `⏸ Manual ${formatRemaining(activeOverrides[key].remainingSeconds)}`;
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
    return `<span class="badge badge-override" id="override-${room}-${device}">⏸ Manual ${formatRemaining(o.remainingSeconds)}</span><button class="btn-resume" data-room="${room}" data-device="${device}">Resume Auto</button>`;
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

    card.innerHTML = `
        <div class="room-card-header">
            <span class="room-name">${rs.room}</span>
            <span class="room-timestamp">${formatTime(rs.lastUpdated)}</span>
        </div>
        <div class="sensor-grid">
            <div class="sensor-row" id="${id}-temp"><span class="sensor-label"><span class="sensor-icon">🌡️</span> Temperature</span><span class="sensor-value temp">${rs.temperature!=null?rs.temperature.toFixed(1)+'°C':'—'}</span></div>
            <div class="sensor-row" id="${id}-lux"><span class="sensor-label"><span class="sensor-icon">☀️</span> Light Level</span><span class="sensor-value">${rs.lightLevel!=null?Math.round(rs.lightLevel)+' lux':'—'}</span></div>
            <div class="sensor-row controllable" id="${id}-door">
                <span class="sensor-label"><span class="sensor-icon">🚪</span> Door</span>
                <div class="sensor-control">
                    ${doorBadge(rs.doorState)}
                    <button class="btn-toggle ${doorOpen ? 'active' : ''}" data-room="${rs.room}" data-device="door" data-next="${doorOpen ? 'CLOSED' : 'OPEN'}">${doorOpen ? 'Close' : 'Open'}</button>
                    ${overrideBadge(rs.room, 'DOOR')}
                </div>
            </div>
            <div class="sensor-row controllable" id="${id}-light">
                <span class="sensor-label"><span class="sensor-icon">💡</span> Light</span>
                <div class="sensor-control">
                    ${lightBadge(rs.lightState)}
                    <button class="btn-toggle ${lightOn ? 'active' : ''}" data-room="${rs.room}" data-device="light" data-next="${lightOn ? 'OFF' : 'ON'}">${lightOn ? 'Turn Off' : 'Turn On'}</button>
                    ${overrideBadge(rs.room, 'LIGHT')}
                </div>
            </div>
            <div class="sensor-row controllable" id="${id}-fan">
                <span class="sensor-label"><span class="sensor-icon">🌀</span> Fan</span>
                <div class="sensor-control">
                    ${fanBadge(rs.fanState)}
                    <button class="btn-toggle ${fanOn ? 'active' : ''}" data-room="${rs.room}" data-device="fan" data-next="${fanOn ? 'OFF' : 'ON'}">${fanOn ? 'Turn Off' : 'Turn On'}</button>
                    ${overrideBadge(rs.room, 'FAN')}
                </div>
            </div>
            <div class="sensor-row" id="${id}-motion"><span class="sensor-label"><span class="sensor-icon">🏃</span> Motion</span>${motionBadge(rs.motionDetected)}</div>
            <div class="sensor-row" id="${id}-smoke"><span class="sensor-label"><span class="sensor-icon">🔥</span> Smoke</span>${smokeBadge(rs.smokeDetected)}</div>
        </div>`;

    // Wire toggle buttons
    card.querySelectorAll('.btn-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            controlDevice(btn.dataset.room, btn.dataset.device, btn.dataset.next);
        });
    });

    // Wire resume auto buttons
    card.querySelectorAll('.btn-resume').forEach(btn => {
        btn.addEventListener('click', () => {
            removeOverride(btn.dataset.room, btn.dataset.device);
        });
    });

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
    if (connection) { try { await connection.stop(); } catch {} }
    for (const k in rooms) delete rooms[k];
    roomGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><p>Connecting to home ${currentHomeId}...</p></div>`;
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
            roomGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">🏠</div><p>Connected to home ${currentHomeId}, waiting for sensor data...</p></div>`;
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

// ---- Events ----
authSubmit.addEventListener('click', handleAuth);
authPassword.addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
logoutBtn.addEventListener('click', logout);
addHomeBtn.addEventListener('click', addHome);
newHomeInput.addEventListener('keydown', e => { if (e.key === 'Enter') addHome(); });
homeSelect.addEventListener('change', () => { currentHomeId = homeSelect.value; if (currentHomeId) connectToHome(); });

// ---- Init ----
setAuthMode(true);
if (token && userEmail) {
    enterApp();
} else {
    appSection.style.display = 'none';
}
