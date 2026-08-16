const tableBody = document.getElementById('submissionsTableBody');
const refreshButton = document.getElementById('refreshButton');
const searchInput = document.getElementById('searchInput');
const yearNode = document.getElementById('year');

if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

const revealItems = document.querySelectorAll('.reveal');
if (revealItems.length > 0) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 }
  );

  revealItems.forEach((item) => observer.observe(item));
}

const API_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') && window.location.host
  ? ''
  : 'http://localhost:3000';

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

async function loadSubmissions() {
  try {
    const response = await fetch(`${API_BASE}/api/submissions`);
    const data = await response.json();

    allSubmissions = Array.isArray(data) ? data : [];
    renderSubmissions();
  } catch (error) {
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="6" class="empty-state">Failed to load submissions.</td></tr>';
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
      item.message
    ]
      .join(' ')
      .toLowerCase();

    return searchable.includes(query);
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No inquiries match your search.</td></tr>';
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
  try {
    const response = await fetch(`${API_BASE}/api/submissions/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Delete failed');
    }

    await loadSubmissions();
  } catch (error) {
    alert('Could not delete this inquiry.');
  }
}

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

loadSubmissions();
setInterval(loadSubmissions, 5000);
