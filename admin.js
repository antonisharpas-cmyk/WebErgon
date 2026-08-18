const tableBody = document.getElementById('submissionsTableBody');
const refreshButton = document.getElementById('refreshButton');
const logoutButton = document.getElementById('logoutButton');
const searchInput = document.getElementById('searchInput');
const yearNode = document.getElementById('year');

const loginModal = document.getElementById('loginModal');
const adminContent = document.getElementById('adminContent');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

/* Always use the same origin (IP or localhost) that served this page.
   This ensures the admin works from any PC accessing via IP address. */
const API_BASE = '';

function getToken() {
  return sessionStorage.getItem('adminToken') || '';
}

function setToken(token) {
  sessionStorage.setItem('adminToken', token);
}

function clearToken() {
  sessionStorage.removeItem('adminToken');
}

function showLoginModal() {
  if (loginModal) loginModal.classList.remove('hidden');
  if (adminContent) adminContent.classList.add('hidden');
}

function showAdminContent() {
  if (loginModal) loginModal.classList.add('hidden');
  if (adminContent) adminContent.classList.remove('hidden');

  const revealItems = document.querySelectorAll('.reveal');
  revealItems.forEach(item => item.classList.add('visible'));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return isNaN(date.getTime()) ? value : date.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let allSubmissions = [];
let autoRefreshInterval = null;

async function loadSubmissions() {
  const token = getToken();
  if (!token) {
    showLoginModal();
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/submissions`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 401) {
      clearToken();
      showLoginModal();
      return;
    }

    const data = await response.json();
    showAdminContent();
    allSubmissions = Array.isArray(data) ? data : [];
    renderSubmissions();
  } catch (error) {
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="7" class="empty-state">Failed to load submissions.</td></tr>';
    }
  }
}

function renderSubmissions() {
  if (!tableBody) return;

  const query = (searchInput?.value || '').trim().toLowerCase();

  const filtered = allSubmissions.filter((item) => {
    if (!query) return true;

    const searchable = [
      item.name,
      item.email,
      item.company,
      item.phone,
      item.message
    ]
      .join(' ')
      .toLowerCase();

    return searchable.includes(query);
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="7" class="empty-state">No inquiries match your search.</td></tr>';
    return;
  }

  tableBody.innerHTML = filtered
    .slice()
    .reverse()
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.name || '—')}</td>
          <td>${escapeHtml(item.email || '—')}</td>
          <td>${escapeHtml(item.company || '—')}</td>
          <td>${escapeHtml(item.phone || '—')}</td>
          <td>${escapeHtml(item.message || '—')}</td>
          <td>${formatDate(item.createdAt)}</td>
          <td>
            <button class="delete-button" data-id="${item.id}" type="button">Delete</button>
          </td>
        </tr>
      `
    )
    .join('');
}

async function deleteSubmission(id) {
  const token = getToken();
  if (!token) {
    showLoginModal();
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/submissions/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 401) {
      clearToken();
      showLoginModal();
      return;
    }

    if (!response.ok) {
      throw new Error('Delete failed');
    }

    await loadSubmissions();
  } catch (error) {
    alert('Could not delete this inquiry.');
  }
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (loginError) loginError.textContent = '';

    const username = document.getElementById('usernameInput')?.value || '';
    const password = document.getElementById('passwordInput')?.value || '';

    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Invalid username or password.');
      }

      setToken(result.token);
      if (loginForm) loginForm.reset();
      showAdminContent();
      await loadSubmissions();
    } catch (error) {
      if (loginError) loginError.textContent = error.message;
    }
  });
}

logoutButton?.addEventListener('click', () => {
  clearToken();
  showLoginModal();
});

searchInput?.addEventListener('input', renderSubmissions);
refreshButton?.addEventListener('click', loadSubmissions);

tableBody?.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('.delete-button');
  if (!deleteButton) return;

  const id = Number(deleteButton.dataset.id);
  if (!Number.isNaN(id)) {
    deleteSubmission(id);
  }
});

// Initial check
if (getToken()) {
  loadSubmissions();
} else {
  showLoginModal();
}

autoRefreshInterval = setInterval(() => {
  if (getToken()) {
    loadSubmissions();
  }
}, 5000);
