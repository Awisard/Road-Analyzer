const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const canvasPlaceholder = document.getElementById('canvasPlaceholder');
const scanLine = document.getElementById('scanLine');
const overlayToggle = document.getElementById('overlayToggle');

const presetSelect = document.getElementById('preset');
const altitudeInput = document.getElementById('altitude');
const sensorWidthInput = document.getElementById('sensorWidth');
const focalLengthInput = document.getElementById('focalLength');
const laneWidthInput = document.getElementById('laneWidth');

const roadTypeValue = document.getElementById('roadTypeValue');
const roadTypeBasis = document.getElementById('roadTypeBasis');
const breakdownBars = document.getElementById('breakdownBars');
const classCounts = document.getElementById('classCounts');
const lengthValue = document.getElementById('lengthValue');
const gsdValue = document.getElementById('gsdValue');
const analysisNote = document.getElementById('analysisNote');
const modelStatusText = document.getElementById('modelStatusText');
const statusDot = document.getElementById('statusDot');

let selectedFile = null;
let baseImage = null;   // HTMLImageElement of the uploaded photo
let overlayImage = null; // HTMLImageElement of the returned segmentation overlay

const CLASS_LABELS = {
  road: 'Road',
  lane: 'Lane',
  sidewalk: 'Sidewalk',
  crosswalk: 'Crosswalk',
  traffic_light: 'Traffic light',
  shoulder: 'Shoulder',
  carriageway: 'Carriageway',
  divider: 'Divider / median',
};
const CLASS_COLORS = {
  road: '#2E5EAA',
  lane: '#F5A623',
  sidewalk: '#4FD1C5',
  crosswalk: '#E8ECF4',
  traffic_light: '#E24B4B',
  shoulder: '#C9A227',
  carriageway: '#2E5EAA',
  divider: '#E24B4B',
};

// ---- Model status badge ----
fetch('/api/analyze/model-info')
  .then((r) => r.json())
  .then((info) => {
    if (info.loaded) {
      modelStatusText.textContent = `MODEL: ${info.mode.toUpperCase()} (${info.classNames.length} classes)`;
      statusDot.style.background = '#4FD1C5';
      statusDot.style.boxShadow = '0 0 8px #4FD1C5';
    } else {
      modelStatusText.textContent = 'MODEL: PLACEHOLDER-DEMO';
    }
  })
  .catch(() => {});

// ---- Presets ----
fetch('/api/analyze/presets')
  .then((r) => r.json())
  .then((presets) => {
    presetSelect.addEventListener('change', () => applyPreset(presets));
    applyPreset(presets);
  })
  .catch(() => {});

function applyPreset(presets) {
  const p = presets[presetSelect.value];
  if (!p || p.sensorWidthMm == null) return; // "custom" — leave fields editable/blank
  sensorWidthInput.value = p.sensorWidthMm;
  focalLengthInput.value = p.focalLengthMm;
}

// ---- Upload handling ----
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  selectedFile = file;
  analyzeBtn.disabled = false;
  overlayImage = null;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    baseImage = img;
    canvasPlaceholder.style.display = 'none';
    drawCanvas();
  };
  img.src = url;
}

function drawCanvas() {
  if (!baseImage) return;
  const maxW = 640;
  const scale = Math.min(1, maxW / baseImage.width);
  canvas.width = baseImage.width * scale;
  canvas.height = baseImage.height * scale;

  ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
  if (overlayImage && overlayToggle.checked) {
    ctx.drawImage(overlayImage, 0, 0, canvas.width, canvas.height);
  }
}

overlayToggle.addEventListener('change', drawCanvas);

// ---- Analyze ----
analyzeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing…';

  const formData = new FormData();
  formData.append('image', selectedFile);
  if (altitudeInput.value) formData.append('altitudeM', altitudeInput.value);
  if (sensorWidthInput.value) formData.append('sensorWidthMm', sensorWidthInput.value);
  if (focalLengthInput.value) formData.append('focalLengthMm', focalLengthInput.value);
  if (laneWidthInput.value) formData.append('laneWidthM', laneWidthInput.value);

  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');
    renderResult(data);
  } catch (err) {
    analysisNote.textContent = `Error: ${err.message}`;
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Run Analysis';
  }
});

function renderResult(data) {
  // Overlay image
  const img = new Image();
  img.onload = () => {
    overlayImage = img;
    drawCanvas();
    playScanAnimation();
  };
  img.src = data.overlayPngBase64;

  // Road type
  roadTypeValue.textContent = data.roadType;
  roadTypeBasis.textContent = data.roadTypeBasis || '';

  // Breakdown bars
  breakdownBars.innerHTML = '';
  Object.entries(data.classBreakdown).forEach(([cls, pct]) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-row-label">
        <span>${CLASS_LABELS[cls] || cls}</span>
        <span class="mono">${pct}%</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%; background:${CLASS_COLORS[cls] || '#888'}"></div>
      </div>`;
    breakdownBars.appendChild(row);
  });

  classCounts.innerHTML = '';
  Object.entries(data.classCounts || {}).forEach(([cls, count]) => {
    const row = document.createElement('div');
    row.className = 'count-row';
    row.innerHTML = `<span>${CLASS_LABELS[cls] || cls}</span><strong class="mono">${count}</strong>`;
    classCounts.appendChild(row);
  });

  // Length
  const m = data.measurement;
  if (m.roadLengthM != null) {
    lengthValue.textContent = `${m.roadLengthM} m`;
    gsdValue.textContent = `GSD ${m.gsdMetersPerPixel} m/px`;
    analysisNote.textContent = '';
  } else {
    lengthValue.textContent = '—';
    gsdValue.textContent = '';
    analysisNote.textContent = m.note || '';
  }
}

function playScanAnimation() {
  scanLine.classList.remove('playing');
  // eslint-disable-next-line no-unused-expressions
  scanLine.offsetHeight; // force reflow to restart animation
  scanLine.classList.add('playing');
}
