const token = localStorage.getItem('jwt');
if (!token) {
    window.location.href = 'index.html';
}

// DOM Elements
const homeSelect = document.getElementById('homeSelect');
const roomSelect = document.getElementById('roomSelect');
const sensorSelect = document.getElementById('sensorSelect');
const refreshBtn = document.getElementById('refreshBtn');
const ctx = document.getElementById('analyticsChart').getContext('2d');

let chartInstance = null;

// Helper to fetch with token
async function apiFetch(url) {
    return await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
}

// Load Homes
async function loadHomes() {
    try {
        const res = await apiFetch('/api/homes');
        if (!res.ok) throw new Error('Failed to load homes');
        const homes = await res.json();
        
        homeSelect.innerHTML = '<option value="">Select Home</option>';
        homes.forEach(h => {
            const opt = document.createElement('option');
            opt.value = h.homeId;
            opt.textContent = h.name || h.homeId;
            homeSelect.appendChild(opt);
        });

        if (homes.length > 0) {
            homeSelect.value = homes[0].homeId;
            await loadRooms(homes[0].homeId);
        }
    } catch (e) {
        console.error(e);
    }
}

// Load Rooms for a home
async function loadRooms(homeId) {
    try {
        const res = await apiFetch(`/api/homes/${homeId}/state`);
        if (!res.ok) throw new Error('Failed to load rooms');
        const state = await res.json();
        
        roomSelect.innerHTML = '<option value="">All Rooms</option>';
        Object.keys(state).forEach(room => {
            const opt = document.createElement('option');
            opt.value = room;
            opt.textContent = room;
            roomSelect.appendChild(opt);
        });
        
        loadAnalytics(); // Load initial data
    } catch (e) {
        console.error(e);
    }
}

// Load Analytics Data
async function loadAnalytics() {
    const homeId = homeSelect.value;
    const room = roomSelect.value;
    const type = sensorSelect.value; // "Temperature" or "LightLevel"

    if (!homeId) return;

    let url = `/api/homes/${homeId}/logs?type=${type}&limit=100`;
    if (room) url += `&room=${encodeURIComponent(room)}`;

    try {
        refreshBtn.textContent = 'Loading...';
        refreshBtn.disabled = true;

        const res = await apiFetch(url);
        if (!res.ok) throw new Error('Failed to fetch logs');
        const logs = await res.json();

        // Sort chronological (oldest to newest for graph)
        logs.reverse();

        const labels = [];
        const data = [];

        logs.forEach(log => {
            try {
                // The DB stores Payload as JSON string: {"value":23.5,"unit":"C"}
                const payload = JSON.parse(log.payload);
                if (payload.value !== undefined) {
                    const date = new Date(log.timestamp);
                    labels.push(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second:'2-digit' }));
                    data.push(payload.value);
                }
            } catch (err) {
                // Skip unparseable payloads
            }
        });

        renderChart(labels, data, type);
    } catch (e) {
        console.error(e);
        alert('Failed to load analytics data.');
    } finally {
        refreshBtn.textContent = 'Refresh Data';
        refreshBtn.disabled = false;
    }
}

// Render Chart.js
function renderChart(labels, data, type) {
    if (chartInstance) {
        chartInstance.destroy();
    }

    const color = type === 'Temperature' ? 'rgba(245, 158, 11, 1)' : 'rgba(61, 214, 200, 1)';
    const bgColor = type === 'Temperature' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(61, 214, 200, 0.2)';
    const label = type === 'Temperature' ? 'Temperature (°C)' : 'Light Level (lux)';

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                borderColor: color,
                backgroundColor: bgColor,
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: color,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#9ca3af' }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#9ca3af' },
                    beginAtZero: type === 'LightLevel'
                }
            },
            plugins: {
                legend: { labels: { color: '#fff' } }
            }
        }
    });
}

// Event Listeners
homeSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val) loadRooms(val);
});

roomSelect.addEventListener('change', loadAnalytics);
sensorSelect.addEventListener('change', loadAnalytics);
refreshBtn.addEventListener('click', loadAnalytics);

// Init
loadHomes();
