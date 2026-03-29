import {
  validateMovExtension,
  validateMovMagicBytes,
  qualityToCRF,
  formatFileSize,
  formatDuration,
  formatETA,
  PLATFORM_PRESETS,
  WATERMARK_FONTS,
  VIDEO_FILTERS,
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
const btnBack = $('#btnBack');
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
const watermarkOpacity = $('#watermarkOpacity');
const watermarkOpacityValue = $('#watermarkOpacityValue');
let watermarkFile = null;
let watermarkCustomX = null;
let watermarkCustomY = null;
const textWmCheckbox = $('#textWmCheckbox');
const textWmOptions = $('#textWmOptions');
const textWmInput = $('#textWmInput');
const textWmFont = $('#textWmFont');
const textWmColor = $('#textWmColor');
const textWmSize = $('#textWmSize');
const textWmSizeValue = $('#textWmSizeValue');
const textWmOpacity = $('#textWmOpacity');
const textWmOpacityValue = $('#textWmOpacityValue');
const textWmPosition = $('#textWmPosition');
let textWmCustomX = null;
let textWmCustomY = null;
// Unified preview refs
const wmPreview = $('#wmPreview');
const wmOriginalBox = $('#wmOriginalBox');
const wmOriginalCanvas = $('#wmOriginalCanvas');
const wmPreviewBox = $('#wmPreviewBox');
const wmPreviewCanvas = $('#wmPreviewCanvas');
const wmPreviewImg = $('#wmPreviewImg');
const wmPreviewText = $('#wmPreviewText');
let isDraggingWm = false;
let dragWmTarget = null;
let dragWmOffsetX = 0;
let dragWmOffsetY = 0;
// Filter ref
const filterGrid = $('#filterGrid');
let selectedFilter = 'none';
// Mute ref
const muteCheckbox = $('#muteCheckbox');
// Speed refs
const speedSlider = $('#speedSlider');
const speedValue = $('#speedValue');
// Target size refs
const targetSizeCheckbox = $('#targetSizeCheckbox');
const targetSizeControls = $('#targetSizeControls');
const targetSizeInput = $('#targetSizeInput');
const qualityGroup = $('.settings__group--quality');
// Trim refs
const trimCheckbox = $('#trimCheckbox');
const trimControls = $('#trimControls');
const trimStart = $('#trimStart');
const trimEnd = $('#trimEnd');
const trimStartLabel = $('#trimStartLabel');
const trimEndLabel = $('#trimEndLabel');
const trimDurationLabel = $('#trimDurationLabel');
const trimTrack = $('#trimTrack');
let videoDuration = 0;

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

// ─── Trim ───────────────────────────────────────────────────────────────────
trimCheckbox.addEventListener('change', () => {
  trimControls.style.display = trimCheckbox.checked ? '' : 'none';
});

function updateTrimUI() {
  const s = parseFloat(trimStart.value);
  const e = parseFloat(trimEnd.value);
  trimStartLabel.textContent = formatDuration(s);
  trimEndLabel.textContent = formatDuration(e);
  trimDurationLabel.textContent = formatDuration(Math.max(0, e - s));
  // Update track highlight
  const max = parseFloat(trimStart.max) || 1;
  const pctStart = (s / max) * 100;
  const pctEnd = (e / max) * 100;
  trimTrack.style.background = `linear-gradient(to right, var(--bg-elevated) ${pctStart}%, var(--accent-primary) ${pctStart}%, var(--accent-primary) ${pctEnd}%, var(--bg-elevated) ${pctEnd}%)`;
}

trimStart.addEventListener('input', () => {
  if (parseFloat(trimStart.value) >= parseFloat(trimEnd.value)) {
    trimStart.value = Math.max(0, parseFloat(trimEnd.value) - 0.1);
  }
  updateTrimUI();
});

trimEnd.addEventListener('input', () => {
  if (parseFloat(trimEnd.value) <= parseFloat(trimStart.value)) {
    trimEnd.value = Math.min(videoDuration, parseFloat(trimStart.value) + 0.1);
  }
  updateTrimUI();
});

// ─── Speed ──────────────────────────────────────────────────────────────────
speedSlider.addEventListener('input', () => {
  speedValue.textContent = speedSlider.value + 'x';
});

// ─── Target Size ────────────────────────────────────────────────────────────
targetSizeCheckbox.addEventListener('change', () => {
  targetSizeControls.style.display = targetSizeCheckbox.checked ? '' : 'none';
  qualityGroup.style.display = targetSizeCheckbox.checked ? 'none' : '';
});

for (const btn of document.querySelectorAll('.settings__targetsize-btn')) {
  btn.addEventListener('click', () => {
    targetSizeInput.value = btn.dataset.size;
  });
}

// ─── Video Filter ───────────────────────────────────────────────────────────
// Build filter buttons
for (const [id, f] of Object.entries(VIDEO_FILTERS)) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings__filter-btn' + (id === 'none' ? ' settings__filter-btn--active' : '');
  btn.dataset.filter = id;
  btn.textContent = f.label;
  filterGrid.appendChild(btn);
}

filterGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.settings__filter-btn');
  if (!btn) return;
  selectedFilter = btn.dataset.filter;
  for (const b of filterGrid.querySelectorAll('.settings__filter-btn')) {
    b.classList.toggle('settings__filter-btn--active', b.dataset.filter === selectedFilter);
  }
  updateWmPreview();
});

// ─── Mirror → refresh previews ──────────────────────────────────────────────
mirrorCheckbox.addEventListener('change', () => {
  updateWmPreview();
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
  instagramFormat.style.display = selectedPlatform === 'instagram' ? '' : 'none';

  const preset = PLATFORM_PRESETS[selectedPlatform];
  platformHint.textContent = isCustom ? '' : preset.description;
});

// ─── Watermark (image) ──────────────────────────────────────────────────────
watermarkCheckbox.addEventListener('change', () => {
  watermarkOptions.hidden = !watermarkCheckbox.checked;
  if (!watermarkCheckbox.checked) {
    watermarkFile = null;
    watermarkPreview.src = '/src/img/image.svg';
    watermarkRemove.hidden = true;
    watermarkInput.value = '';
  }
  updateWmPreview();
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
  watermarkRemove.hidden = false;
  updateWmPreview();
});

watermarkRemove.addEventListener('click', () => {
  watermarkFile = null;
  watermarkPreview.src = '/src/img/image.svg';
  watermarkRemove.hidden = true;
  watermarkInput.value = '';
  updateWmPreview();
});

watermarkSize.addEventListener('input', () => {
  watermarkSizeValue.textContent = watermarkSize.value;
  updateWmPreview();
});

watermarkOpacity.addEventListener('input', () => {
  watermarkOpacityValue.textContent = watermarkOpacity.value;
  updateWmPreview();
});

watermarkPosition.addEventListener('change', () => {
  if (watermarkPosition.value !== 'custom') {
    const customOpt = watermarkPosition.querySelector('option[value="custom"]');
    if (customOpt) customOpt.disabled = true;
    watermarkCustomX = null;
    watermarkCustomY = null;
  }
  updateWmPreview();
});

// ─── Watermark (text) ───────────────────────────────────────────────────────
textWmCheckbox.addEventListener('change', () => {
  textWmOptions.hidden = !textWmCheckbox.checked;
  updateWmPreview();
});

for (const el of [textWmInput, textWmFont, textWmColor]) {
  el.addEventListener('input', updateWmPreview);
  el.addEventListener('change', updateWmPreview);
}
textWmPosition.addEventListener('change', () => {
  if (textWmPosition.value !== 'custom') {
    const opt = textWmPosition.querySelector('option[value="custom"]');
    if (opt) opt.disabled = true;
    textWmCustomX = null;
    textWmCustomY = null;
  }
  updateWmPreview();
});
textWmSize.addEventListener('input', () => {
  textWmSizeValue.textContent = textWmSize.value;
  updateWmPreview();
});
textWmOpacity.addEventListener('input', () => {
  textWmOpacityValue.textContent = textWmOpacity.value;
  updateWmPreview();
});

// ─── Unified Watermark Preview ──────────────────────────────────────────────
function presetToPreviewCoords(preset, cW, cH, elW, elH) {
  const margin = videoPreview.videoWidth ? (10 / videoPreview.videoWidth) * cW : 8;
  switch (preset) {
    case 'top-left':     return { x: margin, y: margin };
    case 'top-right':    return { x: cW - elW - margin, y: margin };
    case 'bottom-left':  return { x: margin, y: cH - elH - margin };
    case 'bottom-right': return { x: cW - elW - margin, y: cH - elH - margin };
    case 'center':       return { x: (cW - elW) / 2, y: (cH - elH) / 2 };
    default:             return { x: cW - elW - margin, y: cH - elH - margin };
  }
}

function updateWmPreview() {
  if (!videoPreview.videoWidth) {
    wmPreview.hidden = true;
    return;
  }

  wmPreview.hidden = false;
  const vw = videoPreview.videoWidth;
  const vh = videoPreview.videoHeight;
  const ar = `${vw} / ${vh}`;
  wmOriginalBox.style.aspectRatio = ar;
  wmPreviewBox.style.aspectRatio = ar;

  const cW = wmPreviewBox.clientWidth;
  const cH = wmPreviewBox.clientHeight;

  const hasImg = watermarkCheckbox.checked && watermarkFile;
  const hasTxt = textWmCheckbox.checked && textWmInput.value.trim();

  // Draw original (unmodified) frame
  const oW = wmOriginalBox.clientWidth;
  const oH = wmOriginalBox.clientHeight;
  wmOriginalCanvas.width = oW;
  wmOriginalCanvas.height = oH;
  const origCtx = wmOriginalCanvas.getContext('2d');
  if (videoPreview.readyState >= 2) {
    origCtx.drawImage(videoPreview, 0, 0, oW, oH);
  } else {
    origCtx.fillStyle = '#111';
    origCtx.fillRect(0, 0, oW, oH);
  }

  // Draw result frame (with mirror + filter)
  wmPreviewCanvas.width = cW;
  wmPreviewCanvas.height = cH;
  const ctx = wmPreviewCanvas.getContext('2d');
  if (mirrorCheckbox.checked) {
    ctx.translate(cW, 0);
    ctx.scale(-1, 1);
  }
  const cssFilter = VIDEO_FILTERS[selectedFilter]?.css;
  if (cssFilter && cssFilter !== 'none') {
    ctx.filter = cssFilter;
  }
  if (videoPreview.readyState >= 2) {
    ctx.drawImage(videoPreview, 0, 0, cW, cH);
  } else {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, cW, cH);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';

  // ── Image watermark layer ──
  if (hasImg) {
    wmPreviewImg.style.display = '';
    wmPreviewImg.src = watermarkPreview.src;
    const wmDisplayW = cW * (watermarkSize.value / 100);
    wmPreviewImg.style.width = wmDisplayW + 'px';
    wmPreviewImg.style.height = 'auto';
    wmPreviewImg.style.opacity = watermarkOpacity.value / 100;

    wmPreviewImg.onload = () => {
      const wmW = wmPreviewImg.offsetWidth;
      const wmH = wmPreviewImg.offsetHeight;
      let coords;
      if (watermarkPosition.value === 'custom' && watermarkCustomX !== null) {
        coords = { x: watermarkCustomX * cW, y: watermarkCustomY * cH };
      } else {
        coords = presetToPreviewCoords(watermarkPosition.value, cW, cH, wmW, wmH);
      }
      coords.x = Math.max(0, Math.min(cW - wmW, coords.x));
      coords.y = Math.max(0, Math.min(cH - wmH, coords.y));
      wmPreviewImg.style.left = coords.x + 'px';
      wmPreviewImg.style.top = coords.y + 'px';
    };
    if (wmPreviewImg.complete) wmPreviewImg.onload();
  } else {
    wmPreviewImg.style.display = 'none';
  }

  // ── Text watermark layer ──
  if (hasTxt) {
    wmPreviewText.style.display = '';
    const font = WATERMARK_FONTS[textWmFont.value] || WATERMARK_FONTS['arial'];
    const scaledSize = Math.max(8, Math.round((parseInt(textWmSize.value) / vw) * cW));
    wmPreviewText.textContent = textWmInput.value.trim();
    wmPreviewText.style.fontFamily = font.css;
    wmPreviewText.style.fontSize = scaledSize + 'px';
    wmPreviewText.style.fontWeight = textWmFont.value === 'montserrat-bold' ? '700' : '400';
    wmPreviewText.style.color = textWmColor.value;
    wmPreviewText.style.opacity = textWmOpacity.value / 100;

    const elW = wmPreviewText.offsetWidth;
    const elH = wmPreviewText.offsetHeight;
    let x, y;
    if (textWmPosition.value === 'custom' && textWmCustomX !== null) {
      x = textWmCustomX * cW;
      y = textWmCustomY * cH;
    } else {
      const c = presetToPreviewCoords(textWmPosition.value, cW, cH, elW, elH);
      x = c.x; y = c.y;
    }
    x = Math.max(0, Math.min(cW - elW, x));
    y = Math.max(0, Math.min(cH - elH, y));
    wmPreviewText.style.left = x + 'px';
    wmPreviewText.style.top = y + 'px';
  } else {
    wmPreviewText.style.display = 'none';
  }
}

// ─── Unified Drag ───────────────────────────────────────────────────────────
function onWmDragStart(e) {
  const target = e.target;
  if (target !== wmPreviewImg && target !== wmPreviewText) return;
  e.preventDefault();
  isDraggingWm = true;
  dragWmTarget = target;
  target.classList.add('settings__wm-preview-drag--dragging');
  const rect = target.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  dragWmOffsetX = cx - rect.left;
  dragWmOffsetY = cy - rect.top;
}

function onWmDragMove(e) {
  if (!isDraggingWm || !dragWmTarget) return;
  e.preventDefault();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  const boxRect = wmPreviewBox.getBoundingClientRect();
  const elW = dragWmTarget.offsetWidth;
  const elH = dragWmTarget.offsetHeight;
  const newLeft = Math.max(0, Math.min(boxRect.width - elW, cx - boxRect.left - dragWmOffsetX));
  const newTop = Math.max(0, Math.min(boxRect.height - elH, cy - boxRect.top - dragWmOffsetY));
  dragWmTarget.style.left = newLeft + 'px';
  dragWmTarget.style.top = newTop + 'px';
}

function onWmDragEnd() {
  if (!isDraggingWm || !dragWmTarget) return;
  isDraggingWm = false;
  dragWmTarget.classList.remove('settings__wm-preview-drag--dragging');
  const cW = wmPreviewBox.clientWidth;
  const cH = wmPreviewBox.clientHeight;
  const relX = parseFloat(dragWmTarget.style.left) / cW;
  const relY = parseFloat(dragWmTarget.style.top) / cH;

  if (dragWmTarget === wmPreviewImg) {
    watermarkCustomX = relX;
    watermarkCustomY = relY;
    const opt = watermarkPosition.querySelector('option[value="custom"]');
    if (opt) opt.disabled = false;
    watermarkPosition.value = 'custom';
  } else {
    textWmCustomX = relX;
    textWmCustomY = relY;
    const opt = textWmPosition.querySelector('option[value="custom"]');
    if (opt) opt.disabled = false;
    textWmPosition.value = 'custom';
  }
  dragWmTarget = null;
}

wmPreviewImg.addEventListener('mousedown', onWmDragStart);
wmPreviewImg.addEventListener('touchstart', onWmDragStart, { passive: false });
wmPreviewText.addEventListener('mousedown', onWmDragStart);
wmPreviewText.addEventListener('touchstart', onWmDragStart, { passive: false });
document.addEventListener('mousemove', onWmDragMove);
document.addEventListener('touchmove', onWmDragMove, { passive: false });
document.addEventListener('mouseup', onWmDragEnd);
document.addEventListener('touchend', onWmDragEnd);

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

// ─── Slider fill ────────────────────────────────────────────────────────────
function updateSliderFill(slider) {
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max) || 100;
  const pct = ((slider.value - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(to right, var(--accent-primary) ${pct}%, var(--bg-elevated) ${pct}%)`;
}

// Init all sliders
for (const s of document.querySelectorAll('.settings__slider')) {
  s.addEventListener('input', () => updateSliderFill(s));
  updateSliderFill(s);
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
    // Set trim slider range
    videoDuration = videoPreview.duration || 0;
    trimStart.max = videoDuration;
    trimEnd.max = videoDuration;
    trimStart.value = 0;
    trimEnd.value = videoDuration;
    trimControls.style.display = trimCheckbox.checked ? '' : 'none';
    updateTrimUI();
    // Force browser to decode the first frame
    videoPreview.currentTime = 0.001;
  }, { once: true });

  // Render preview once first frame is decoded (after forced seek)
  videoPreview.addEventListener('seeked', () => {
    updateWmPreview();
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
  formData.append('mute', muteCheckbox.checked ? '1' : '0');
  if (selectedFilter !== 'none') {
    formData.append('videoFilter', selectedFilter);
  }
  if (speedSlider.value !== '1') {
    formData.append('speed', speedSlider.value);
  }
  if (targetSizeCheckbox.checked && targetSizeInput.value) {
    formData.append('targetSizeMB', targetSizeInput.value);
  }
  if (trimCheckbox.checked) {
    formData.append('trimStart', trimStart.value);
    formData.append('trimEnd', trimEnd.value);
    formData.append('trimDuration', String(videoDuration));
  }
  if (watermarkCheckbox.checked && watermarkFile) {
    formData.append('watermark', watermarkFile);
    if (watermarkPosition.value === 'custom' && watermarkCustomX !== null) {
      const absX = Math.round(watermarkCustomX * videoPreview.videoWidth);
      const absY = Math.round(watermarkCustomY * videoPreview.videoHeight);
      formData.append('watermarkPosition', `custom:${absX}:${absY}`);
    } else {
      formData.append('watermarkPosition', watermarkPosition.value);
    }
    formData.append('watermarkSize', watermarkSize.value);
    formData.append('watermarkOpacity', String(watermarkOpacity.value / 100));
  }
  if (textWmCheckbox.checked && textWmInput.value.trim()) {
    formData.append('textWm', textWmInput.value.trim());
    formData.append('textWmFont', textWmFont.value);
    formData.append('textWmSize', textWmSize.value);
    formData.append('textWmColor', textWmColor.value);
    formData.append('textWmOpacity', String(textWmOpacity.value / 100));
    if (textWmPosition.value === 'custom' && textWmCustomX !== null) {
      const absX = Math.round(textWmCustomX * videoPreview.videoWidth);
      const absY = Math.round(textWmCustomY * videoPreview.videoHeight);
      formData.append('textWmPosition', `custom:${absX}:${absY}`);
    } else {
      formData.append('textWmPosition', textWmPosition.value);
    }
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
  muteCheckbox.checked = false;
  selectedFilter = 'none';
  for (const b of filterGrid.querySelectorAll('.settings__filter-btn')) {
    b.classList.toggle('settings__filter-btn--active', b.dataset.filter === 'none');
  }
  speedSlider.value = 1;
  speedValue.textContent = '1x';
  targetSizeCheckbox.checked = false;
  targetSizeControls.style.display = 'none';
  targetSizeInput.value = 16;
  qualityGroup.style.display = '';

  // Reset trim
  trimCheckbox.checked = false;
  trimControls.style.display = 'none';
  trimStart.value = 0;
  trimEnd.value = 0;
  videoDuration = 0;

  // Reset watermark
  watermarkCheckbox.checked = false;
  watermarkOptions.hidden = true;
  watermarkFile = null;
  watermarkPreview.src = '/src/img/image.svg';
  watermarkRemove.hidden = true;
  watermarkInput.value = '';
  watermarkPosition.value = 'bottom-right';
  watermarkSize.value = 20;
  watermarkSizeValue.textContent = '20';
  watermarkOpacity.value = 100;
  watermarkOpacityValue.textContent = '100';
  watermarkCustomX = null;
  watermarkCustomY = null;

  // Reset text watermark
  textWmCheckbox.checked = false;
  textWmOptions.hidden = true;
  textWmInput.value = '';
  textWmFont.value = 'arial';
  textWmColor.value = '#ffffff';
  textWmSize.value = 48;
  textWmSizeValue.textContent = '48';
  textWmOpacity.value = 100;
  textWmOpacityValue.textContent = '100';
  textWmPosition.value = 'bottom-right';
  textWmCustomX = null;
  textWmCustomY = null;

  // Reset unified preview
  isDraggingWm = false;
  dragWmTarget = null;
  wmPreview.hidden = true;
  wmPreviewImg.src = '';
  wmPreviewText.textContent = '';
  const wmCustomOpt1 = watermarkPosition.querySelector('option[value="custom"]');
  if (wmCustomOpt1) wmCustomOpt1.disabled = true;
  const wmCustomOpt2 = textWmPosition.querySelector('option[value="custom"]');
  if (wmCustomOpt2) wmCustomOpt2.disabled = true;

  // Reset slider fills
  for (const s of document.querySelectorAll('.settings__slider')) updateSliderFill(s);

  // Reset platform selection
  selectedPlatform = 'custom';
  for (const card of platformGrid.querySelectorAll('.settings__platform-card')) {
    card.classList.toggle('settings__platform-card--active', card.dataset.platform === 'custom');
  }
  const customRadio = platformGrid.querySelector('input[value="custom"]');
  if (customRadio) customRadio.checked = true;
  settingsGrid.classList.remove('settings__grid--platform-active');
  instagramFormat.style.display = 'none';
  platformHint.textContent = '';

  setState('idle');
}

btnAnother.addEventListener('click', resetAll);
btnBack.addEventListener('click', () => {
  if (currentFile) {
    setState('configuring');
    updateWmPreview();
  }
});
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
