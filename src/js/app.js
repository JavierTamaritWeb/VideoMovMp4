import {
  validateMovExtension,
  validateMovMagicBytes,
  qualityToCRF,
  formatFileSize,
  formatDuration,
  formatETA,
  PLATFORM_PRESETS,
} from './converterCore.js';

// ─── State ───────────────────────────────────────────────────────────────────
let currentFile = null;
let currentJobId = null;
let sseSource = null;
let downloadUrl = null;
let sseRetries = 0;
const MAX_SSE_RETRIES = 5;

// UI state: idle | uploading | configuring | converting | done | error
let uiState = 'idle';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const panelUpload = $('#panelUpload');
const panelSettings = $('#panelSettings');
const panelProgress = $('#panelProgress');
const panelResult = $('#panelResult');
const panelError = $('#panelError');
const dropzone = $('#dropzone');
const fileInput = $('#fileInput');
const btnBrowse = $('#btnBrowse');
const btnChange = $('#btnChange');
const btnConvert = $('#btnConvert');
const btnCancel = $('#btnCancel');
const btnDownload = $('#btnDownload');
const btnAnother = $('#btnAnother');
const btnRetry = $('#btnRetry');
const btnReset = $('#btnReset');
const fileInfo = $('#fileInfo');
const fileName = $('#fileName');
const fileSizeEl = $('#fileSize');
const videoPreview = $('#videoPreview');
const qualitySlider = $('#qualitySlider');
const qualityValue = $('#qualityValue');
const qualityLabel = $('#qualityLabel');
const crfValue = $('#crfValue');
const resolutionSelect = $('#resolutionSelect');
const resInfo = $('#resInfo');
const presetSelect = $('#presetSelect');
const progressBar = $('#progressBar');
const progressText = $('#progressText');
const metaCards = $('#metaCards');
const resultPreview = $('#resultPreview');
const errorMessage = $('#errorMessage');
const platformGrid = $('#platformGrid');
const platformHint = $('#platformHint');
const instagramFormat = $('#instagramFormat');
const settingsGrid = $('#settingsGrid');
const mirrorCheckbox = $('#mirrorCheckbox');
const watermarkCheckbox = $('#watermarkCheckbox');
const watermarkOptions = $('#watermarkOptions');
const watermarkInput = $('#watermarkInput');
const watermarkBtn = $('#watermarkBtn');
const watermarkPreview = $('#watermarkPreview');
const watermarkPreviewWrap = $('#watermarkPreviewWrap');
const watermarkRemove = $('#watermarkRemove');
const watermarkPosition = $('#watermarkPosition');
const watermarkSize = $('#watermarkSize');
const watermarkSizeValue = $('#watermarkSizeValue');
let watermarkFile = null;

// ─── Notyf ───────────────────────────────────────────────────────────────────
const notyf = new Notyf({
  duration: 4000,
  position: { x: 'right', y: 'top' },
  ripple: false,
  types: [
    { type: 'success', background: '#10B981' },
    { type: 'error', background: '#EF4444' },
  ],
});

// ─── Platform Selection ──────────────────────────────────────────────────────
let selectedPlatform = 'custom';

platformGrid.addEventListener('change', (e) => {
  if (e.target.name !== 'platform') return;
  selectedPlatform = e.target.value;

  for (const card of platformGrid.querySelectorAll('.settings__platform-card')) {
    card.classList.toggle('settings__platform-card--active', card.dataset.platform === selectedPlatform);
  }

  const isCustom = selectedPlatform === 'custom';
  settingsGrid.classList.toggle('settings__grid--platform-active', !isCustom);
  instagramFormat.hidden = selectedPlatform !== 'instagram';

  const preset = PLATFORM_PRESETS[selectedPlatform];
  platformHint.textContent = isCustom ? '' : preset.description;
});

// ─── Watermark ───────────────────────────────────────────────────────────────
watermarkCheckbox.addEventListener('change', () => {
  watermarkOptions.hidden = !watermarkCheckbox.checked;
  if (!watermarkCheckbox.checked) {
    watermarkFile = null;
    watermarkPreview.src = '';
    watermarkPreviewWrap.hidden = true;
    watermarkInput.value = '';
  }
});

watermarkInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    notyf.error('Selecciona un archivo de imagen (PNG, JPG, WebP, SVG)');
    watermarkInput.value = '';
    return;
  }
  watermarkFile = file;
  watermarkPreview.src = URL.createObjectURL(file);
  watermarkPreviewWrap.hidden = false;
});

watermarkRemove.addEventListener('click', () => {
  watermarkFile = null;
  watermarkPreview.src = '';
  watermarkPreviewWrap.hidden = true;
  watermarkInput.value = '';
});

watermarkSize.addEventListener('input', () => {
  watermarkSizeValue.textContent = watermarkSize.value;
});

// ─── UI State Machine ────────────────────────────────────────────────────────
function setState(state) {
  uiState = state;
  const panels = { panelUpload, panelSettings, panelProgress, panelResult, panelError };
  // Hide all panels first
  for (const p of Object.values(panels)) p.hidden = true;

  switch (state) {
    case 'idle':
      panelUpload.hidden = false;
      fileInfo.hidden = true;
      dropzone.hidden = false;
      break;
    case 'configuring':
      panelUpload.hidden = false;
      dropzone.hidden = true;
      fileInfo.hidden = false;
      panelSettings.hidden = false;
      break;
    case 'converting':
      panelProgress.hidden = false;
      break;
    case 'done':
      panelResult.hidden = false;
      break;
    case 'error':
      panelError.hidden = false;
      break;
  }
}

// ─── Quality slider ─────────────────────────────────────────────────────────
function updateQualityUI() {
  const val = parseInt(qualitySlider.value);
  qualityValue.textContent = val;
  crfValue.textContent = `CRF: ${qualityToCRF(val)}`;

  if (val <= 25) qualityLabel.textContent = 'Baja (archivos pequeños)';
  else if (val <= 50) qualityLabel.textContent = 'Media';
  else if (val <= 75) qualityLabel.textContent = 'Alta (recomendado)';
  else qualityLabel.textContent = 'Máxima (archivos grandes)';
}

qualitySlider.addEventListener('input', updateQualityUI);
updateQualityUI();

// ─── File selection ──────────────────────────────────────────────────────────
async function handleFile(file) {
  if (!file) return;

  // Validate extension
  if (!validateMovExtension(file.name)) {
    notyf.error('Solo se aceptan archivos .mov');
    return;
  }

  // Validate size
  const maxSize = 2 * 1024 * 1024 * 1024; // 2 GB
  if (file.size > maxSize) {
    notyf.error(`Archivo demasiado grande. Máximo: ${formatFileSize(maxSize)}`);
    return;
  }

  // Validate magic bytes
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const magicResult = validateMovMagicBytes(header);
  if (!magicResult.valid) {
    notyf.error(magicResult.reason || 'El archivo no es un vídeo MOV válido');
    return;
  }

  currentFile = file;
  fileName.textContent = file.name;
  fileSizeEl.textContent = formatFileSize(file.size);

  // Video preview
  const objectUrl = URL.createObjectURL(file);
  videoPreview.src = objectUrl;
  videoPreview.load();

  setState('configuring');
  resInfo.textContent = '';

  // Try to read video dimensions from the preview element
  videoPreview.addEventListener('loadedmetadata', () => {
    if (videoPreview.videoWidth && videoPreview.videoHeight) {
      resInfo.textContent = `(actual: ${videoPreview.videoWidth}×${videoPreview.videoHeight})`;
    }
  }, { once: true });
}

// Drag & drop
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('upload__dropzone--active');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('upload__dropzone--active');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('upload__dropzone--active');
  const file = e.dataTransfer?.files?.[0];
  handleFile(file);
});

// Click to browse
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
btnBrowse.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });

fileInput.addEventListener('change', () => {
  handleFile(fileInput.files?.[0]);
  fileInput.value = '';
});

btnChange.addEventListener('click', () => fileInput.click());

// ─── Conversion ──────────────────────────────────────────────────────────────
async function startConversion() {
  if (!currentFile) return;

  setState('converting');

  // Reset progress UI
  progressBar.style.width = '0%';
  progressBar.classList.remove('progress__bar--done');
  progressText.textContent = '0%';
  metaCards.hidden = true;
  resetStats();

  // Build form data
  const formData = new FormData();
  formData.append('video', currentFile);
  formData.append('quality', qualitySlider.value);
  formData.append('resolution', resolutionSelect.value);
  formData.append('preset', presetSelect.value);
  formData.append('platform', selectedPlatform);
  formData.append('mirror', mirrorCheckbox.checked ? '1' : '0');
  if (watermarkCheckbox.checked && watermarkFile) {
    formData.append('watermark', watermarkFile);
    formData.append('watermarkPosition', watermarkPosition.value);
    formData.append('watermarkSize', watermarkSize.value);
  }
  if (selectedPlatform === 'instagram') {
    const igFormat = document.querySelector('input[name="igFormat"]:checked')?.value || 'reels';
    formData.append('igFormat', igFormat);
  }

  try {
    const resp = await fetch('/api/convert', { method: 'POST', body: formData });
    const data = await resp.json();

    if (!resp.ok) {
      showError(data.error || 'Error al iniciar la conversión');
      return;
    }

    currentJobId = data.jobId;
    sessionStorage.setItem('videomovmp4_jobId', currentJobId);
    sseRetries = 0;
    connectSSE(currentJobId);

  } catch (err) {
    showError('Error de conexión: ' + err.message);
  }
}

btnConvert.addEventListener('click', startConversion);

// ─── SSE Connection ──────────────────────────────────────────────────────────
function connectSSE(jobId) {
  if (sseSource) { sseSource.close(); sseSource = null; }

  sseSource = new EventSource(`/api/jobs/${jobId}`);

  sseSource.onmessage = (e) => {
    sseRetries = 0;
    try {
      const event = JSON.parse(e.data);
      handleSSEEvent(event);
    } catch {}
  };

  sseSource.onerror = () => {
    sseSource.close();
    sseSource = null;
    if (uiState === 'converting' && sseRetries < MAX_SSE_RETRIES) {
      const delay = Math.pow(2, sseRetries) * 1000;
      sseRetries++;
      setTimeout(() => connectSSE(jobId), delay);
    }
  };
}

function handleSSEEvent(event) {
  switch (event.type) {
    case 'metadata':
      showMetadata(event.data);
      break;
    case 'progress':
      updateProgress(event.data);
      break;
    case 'done':
      onConversionDone(event.data);
      break;
    case 'error':
      onConversionError(event.data);
      break;
  }
}

function showMetadata(meta) {
  metaCards.hidden = false;
  $('#metaDuration').textContent = formatDuration(meta.duration);
  $('#metaResolution').textContent = `${meta.width}×${meta.height}`;
  $('#metaCodec').textContent = meta.videoCodec;
  $('#metaFps').textContent = meta.fps;
  $('#metaSize').textContent = formatFileSize(meta.fileSize || meta.bitrate || 0);
}

function updateProgress(data) {
  const pct = Math.min(99, data.percent);
  progressBar.style.width = `${pct}%`;
  progressText.textContent = `${pct}%`;
  progressBar.setAttribute('aria-valuenow', pct);

  $('#statFps').textContent = data.fps ? data.fps.toFixed(1) : '--';
  $('#statSpeed').textContent = data.speed || '--';
  $('#statElapsed').textContent = data.elapsed ? formatDuration(data.elapsed) : '--';
  $('#statEta').textContent = data.eta ? formatETA(data.eta) : '--';
}

function resetStats() {
  for (const id of ['statFps', 'statSpeed', 'statElapsed', 'statEta']) {
    $(`#${id}`).textContent = '--';
  }
}

function onConversionDone(data) {
  if (sseSource) { sseSource.close(); sseSource = null; }
  sessionStorage.removeItem('videomovmp4_jobId');

  // Update progress to 100%
  progressBar.style.width = '100%';
  progressBar.classList.add('progress__bar--done');
  progressText.textContent = '100%';

  downloadUrl = data.downloadUrl;

  // Set result preview
  resultPreview.src = downloadUrl;
  resultPreview.load();

  // Size comparison
  const originalSize = currentFile ? currentFile.size : 0;
  $('#resultOriginalSize').textContent = formatFileSize(originalSize);
  $('#resultConvertedSize').textContent = data.outputSizeFormatted || formatFileSize(data.outputSize);

  const savingsCard = $('#savingsCard');
  const savings = data.savings;
  if (savings > 0) {
    savingsCard.classList.remove('result__savings-card--negative');
    savingsCard.querySelector('i').className = 'fa-solid fa-check-circle';
    $('#resultSavings').textContent = `${savings}% más pequeño`;
  } else {
    savingsCard.classList.add('result__savings-card--negative');
    savingsCard.querySelector('i').className = 'fa-solid fa-triangle-exclamation';
    $('#resultSavings').textContent = `${Math.abs(savings)}% más grande`;
  }

  setState('done');

  // Notifications
  notyf.success(`¡Conversión completada! ${data.outputSizeFormatted || ''} (${Math.abs(savings)}% ${savings > 0 ? 'menos' : 'más'})`);
  playCompletionSound();
  notifyIfHidden();
}

function onConversionError(data) {
  if (sseSource) { sseSource.close(); sseSource = null; }
  sessionStorage.removeItem('videomovmp4_jobId');

  if (data.code === 'CANCELLED') {
    setState('configuring');
    notyf.success('Conversión cancelada');
  } else {
    showError(data.message || 'Error durante la conversión');
  }
}

function showError(message) {
  errorMessage.textContent = message;
  setState('error');
  notyf.error(message);
}

// ─── Cancel ──────────────────────────────────────────────────────────────────
btnCancel.addEventListener('click', async () => {
  if (!currentJobId) return;
  if (!confirm('¿Seguro que deseas cancelar la conversión?')) return;

  try {
    await fetch(`/api/jobs/${currentJobId}/cancel`, { method: 'POST' });
  } catch {}
});

// ─── Download ────────────────────────────────────────────────────────────────
btnDownload.addEventListener('click', async () => {
  if (!downloadUrl) return;

  // Try showSaveFilePicker first
  if (window.showSaveFilePicker) {
    try {
      const resp = await fetch(downloadUrl);
      const blob = await resp.blob();
      const handle = await window.showSaveFilePicker({
        suggestedName: `${currentFile?.name?.replace('.mov', '') || 'video'}_convertido.mp4`,
        types: [{ description: 'Vídeo MP4', accept: { 'video/mp4': ['.mp4'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      notyf.success('Archivo guardado');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Fallback to normal download
    }
  }

  // Fallback: anchor download
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${currentFile?.name?.replace('.mov', '') || 'video'}_convertido.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ─── Reset / Another ─────────────────────────────────────────────────────────
function resetAll() {
  if (sseSource) { sseSource.close(); sseSource = null; }
  currentFile = null;
  currentJobId = null;
  downloadUrl = null;
  sessionStorage.removeItem('videomovmp4_jobId');
  videoPreview.src = '';
  resultPreview.src = '';
  qualitySlider.value = 75;
  resolutionSelect.value = 'original';
  presetSelect.value = 'medium';
  updateQualityUI();
  resInfo.textContent = '';

  mirrorCheckbox.checked = false;

  // Reset watermark
  watermarkCheckbox.checked = false;
  watermarkOptions.hidden = true;
  watermarkFile = null;
  watermarkPreview.src = '';
  watermarkPreviewWrap.hidden = true;
  watermarkInput.value = '';
  watermarkPosition.value = 'bottom-right';
  watermarkSize.value = 20;
  watermarkSizeValue.textContent = '20';

  // Reset platform selection
  selectedPlatform = 'custom';
  for (const card of platformGrid.querySelectorAll('.settings__platform-card')) {
    card.classList.toggle('settings__platform-card--active', card.dataset.platform === 'custom');
  }
  const customRadio = platformGrid.querySelector('input[value="custom"]');
  if (customRadio) customRadio.checked = true;
  settingsGrid.classList.remove('settings__grid--platform-active');
  instagramFormat.hidden = true;
  platformHint.textContent = '';

  setState('idle');
}

btnAnother.addEventListener('click', resetAll);
btnRetry.addEventListener('click', () => {
  if (currentFile) {
    setState('configuring');
  } else {
    resetAll();
  }
});
btnReset.addEventListener('click', resetAll);

// ─── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;

  // Ctrl/Cmd + Enter: start conversion
  if (mod && e.key === 'Enter' && uiState === 'configuring' && currentFile) {
    e.preventDefault();
    startConversion();
  }

  // Escape: cancel
  if (e.key === 'Escape' && uiState === 'converting') {
    e.preventDefault();
    btnCancel.click();
  }

  // Ctrl/Cmd + S: download
  if (mod && e.key === 's' && uiState === 'done' && downloadUrl) {
    e.preventDefault();
    btnDownload.click();
  }
});

// ─── Completion sound ────────────────────────────────────────────────────────
function playCompletionSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

// ─── Browser notification ────────────────────────────────────────────────────
function notifyIfHidden() {
  if (document.visibilityState !== 'hidden') return;
  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    new Notification('VideoMovMp4', { body: 'Tu vídeo está listo para descargar' });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        new Notification('VideoMovMp4', { body: 'Tu vídeo está listo para descargar' });
      }
    });
  }
}

// ─── Session recovery ────────────────────────────────────────────────────────
function tryRecoverSession() {
  const savedJobId = sessionStorage.getItem('videomovmp4_jobId');
  if (!savedJobId) return;

  currentJobId = savedJobId;
  setState('converting');
  metaCards.hidden = true;
  progressBar.style.width = '0%';
  progressText.textContent = 'Reconectando...';
  resetStats();
  sseRetries = 0;
  connectSSE(savedJobId);
}

// ─── Live-reload (dev) ──────────────────────────────────────────────────────
function connectLiveReload() {
  const evtSource = new EventSource('/api/livereload');
  evtSource.onmessage = (e) => {
    if (e.data === 'reload') location.reload();
  };
  evtSource.onerror = () => {
    evtSource.close();
    setTimeout(connectLiveReload, 3000);
  };
}

// ─── Init ────────────────────────────────────────────────────────────────────
setState('idle');
tryRecoverSession();
connectLiveReload();
