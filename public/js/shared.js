// Shared utility functions for BusTrack

const API_BASE = ''; // Same origin

// Show custom toast notification
function showToast(message, type = 'info') {
  // Remove existing toast if any
  const existing = document.getElementById('toast-notification');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'toast-notification';
  toast.className = 'glass-panel notification-banner';
  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.left = '24px';
  toast.style.zIndex = '9999';
  
  let borderColor = 'var(--primary)';
  let iconClass = 'fa-info-circle';
  if (type === 'success') {
    borderColor = 'var(--accent-teal)';
    iconClass = 'fa-check-circle';
  } else if (type === 'warning') {
    borderColor = 'var(--accent-amber)';
    iconClass = 'fa-exclamation-triangle';
  } else if (type === 'danger') {
    borderColor = 'var(--accent-rose)';
    iconClass = 'fa-times-circle';
  }

  toast.style.borderLeft = `4px solid ${borderColor}`;
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 15px; text-align: right; direction: rtl;">
      <i class="fas ${iconClass}" style="color: ${borderColor}; font-size: 20px;"></i>
      <div style="flex: 1;">
        <p style="font-weight: 600; font-size: 15px; margin: 0; color: #ffffff;">${message}</p>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 14px;">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;

  document.body.appendChild(toast);

  // Auto remove after 5 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'slideIn 0.3s reverse';
      setTimeout(() => toast.remove(), 280);
    }
  }, 5000);
}

// Make authenticated API calls
async function apiCall(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('bustrack_token');
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    
    // Check for auth failure
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('bustrack_token');
      localStorage.removeItem('bustrack_user');
      window.location.href = '/login.html';
      throw new Error('Session expired or unauthorized');
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'API Error');
    }
    return data;
  } catch (err) {
    console.error(`API Call failed on ${endpoint}:`, err);
    throw err;
  }
}

// Check auth status on load
function checkAuth(allowedRoles = []) {
  const token = localStorage.getItem('bustrack_token');
  const userStr = localStorage.getItem('bustrack_user');

  if (!token || !userStr) {
    window.location.href = '/login.html';
    return null;
  }

  const user = JSON.parse(userStr);
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    // Send user to their appropriate dashboard
    if (user.role === 'super_admin') window.location.href = '/super.html';
    else if (user.role === 'admin') window.location.href = '/admin.html';
    else if (user.role === 'driver') window.location.href = '/driver.html';
    else window.location.href = '/passenger.html';
    return null;
  }

  return user;
}

// Setup common header element
function setupHeader(user) {
  const header = document.querySelector('header');
  if (!header) return;

  const initial = user.name ? user.name.charAt(0) : 'U';
  
  let arabicRole = 'مستخدم';
  if (user.role === 'super_admin') arabicRole = 'مسؤول المنصة (Super Admin)';
  if (user.role === 'admin') arabicRole = 'مسؤول النظام';
  if (user.role === 'driver') arabicRole = 'سائق';
  if (user.role === 'passenger') arabicRole = 'راكب';

  header.innerHTML = `
    <div class="logo">
      <i class="fas fa-bus-alt"></i>
      <span>BusTrack</span>
    </div>
    <div class="user-profile">
      <div style="text-align: left; line-height: 1.2;">
        <h4 style="margin: 0; font-size: 15px;">${user.name}</h4>
        <span style="font-size: 12px; color: var(--text-secondary);">${arabicRole}</span>
      </div>
      <div class="user-avatar">${initial}</div>
      <button class="logout-btn" onclick="logout()">خروج</button>
    </div>
  `;
}

function logout() {
  localStorage.removeItem('bustrack_token');
  localStorage.removeItem('bustrack_user');
  window.location.href = '/login.html';
}

// Play notification sound
function playNotificationSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.15);
  } catch (e) {
    console.log('AudioContext blocked or unsupported');
  }
}
