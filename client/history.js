const historyGrid = document.getElementById('historyGrid');
const historyStatus = document.getElementById('historyStatus');
const refreshHistory = document.getElementById('refreshHistory');
const modelStatusText = document.getElementById('modelStatusText');
const statusDot = document.getElementById('statusDot');

const CLASS_LABELS = {
  road: 'Road',
  lane: 'Lane',
  sidewalk: 'Sidewalk',
  crosswalk: 'Crosswalk',
  traffic_light: 'Traffic light',
};

fetch('/api/analyze/model-info')
  .then((response) => response.json())
  .then((info) => {
    if (!info.loaded) return;
    modelStatusText.textContent = `MODEL: ${info.mode.toUpperCase()} (${info.classNames.length} classes)`;
    statusDot.style.background = '#4FD1C5';
    statusDot.style.boxShadow = '0 0 8px #4FD1C5';
  })
  .catch(() => {});

refreshHistory.addEventListener('click', loadHistory);
loadHistory();

async function loadHistory() {
  historyStatus.textContent = 'Loading saved analyses...';
  try {
    const response = await fetch('/api/history');
    const entries = await response.json();
    if (!response.ok) throw new Error(entries.error || 'History unavailable');
    renderHistory(entries);
    historyStatus.textContent = entries.length
      ? `${entries.length} saved analysis${entries.length === 1 ? '' : 'es'}`
      : 'No saved analyses yet.';
  } catch (error) {
    historyGrid.innerHTML = '';
    historyStatus.textContent = `Error: ${error.message}`;
  }
}

function renderHistory(entries) {
  historyGrid.innerHTML = '';
  entries.forEach((entry) => {
    const card = document.createElement('article');
    card.className = 'history-card';
    const date = new Date(entry.createdAt).toLocaleString();
    const counts = Object.entries(entry.classCounts || {})
      .filter(([, count]) => count > 0)
      .map(([className, count]) => `${CLASS_LABELS[className] || className}: ${count}`)
      .join(' · ');
    card.innerHTML = `
      <img src="${entry.overlayUrl}" alt="Analysis overlay for ${entry.originalName}">
      <div class="history-card-body">
        <div class="history-card-topline"><span class="mono">${date}</span><button class="icon-button delete-history" title="Delete saved analysis" aria-label="Delete saved analysis">×</button></div>
        <h2>${entry.roadType || 'Unclassified road'}</h2>
        <p>${entry.originalName} · ${entry.imageWidth} × ${entry.imageHeight}</p>
        <p class="history-counts">${counts || 'No detected objects'}</p>
        <a class="btn-secondary history-open" href="${entry.imageUrl}" target="_blank" rel="noopener">Open original</a>
      </div>`;
    card.querySelector('.delete-history').addEventListener('click', () => deleteHistoryEntry(entry.id));
    historyGrid.appendChild(card);
  });
}

async function deleteHistoryEntry(id) {
  if (!window.confirm('Delete this saved analysis?')) return;
  const response = await fetch(`/api/history/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const data = await response.json();
    historyStatus.textContent = `Error: ${data.error || 'Delete failed'}`;
    return;
  }
  loadHistory();
}
