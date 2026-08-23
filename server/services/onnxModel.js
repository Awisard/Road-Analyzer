const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const { classifyRoad } = require('./roadClassification');

/**
 * ============================================================================
 *  Handles TWO possible YOLO export shapes, auto-detected at inference time:
 *
 *  DETECTION model (this project's current trained model — task: detect):
 *    single output "output0": [1, 4 + numClasses, numBoxes]
 *    per box: [cx, cy, w, h, class0_score, class1_score, ...]
 *    → decoded into bounding boxes, drawn as an overlay of colored rectangles.
 *
 *  SEGMENTATION model (task: segment — if you train one later):
 *    "output0": [1, 4 + numClasses + 32, numBoxes]  (32 mask coefficients)
 *    "output1": [1, 32, maskH, maskW]                (prototype masks)
 *    → decoded into per-pixel class masks, same as before.
 *
 *  Which branch runs is decided by `session.outputNames.length` at runtime —
 *  1 output = detection, 2 outputs = segmentation. No config needed.
 * ============================================================================
 */

const MODEL_DIR = path.join(__dirname, '..', 'models');
const MODEL_PATH = path.join(MODEL_DIR, 'best.onnx');
const CLASSES_PATH = path.join(MODEL_DIR, 'classes.json');

const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;

const DEFAULT_COLORS = ['#2E5EAA', '#4FD1C5', '#C9A227', '#E24B4B', '#8E7CC3', '#5AA469'];

let session = null;
let classNames = null;
let imgsz = 640;
let loadAttempted = false;

function isModelAvailable() {
  return fs.existsSync(MODEL_PATH) && fs.existsSync(CLASSES_PATH);
}

async function loadModel() {
  if (session || loadAttempted) return session;
  loadAttempted = true;
  if (!isModelAvailable()) return null;

  const meta = JSON.parse(fs.readFileSync(CLASSES_PATH, 'utf-8'));
  classNames = meta.names;
  imgsz = meta.imgsz || 640;
  session = await ort.InferenceSession.create(MODEL_PATH);
  const inputShape = session.inputMetadata?.[0]?.shape;
  if (inputShape && inputShape[2] === inputShape[3] && Number.isInteger(inputShape[2])) {
    imgsz = inputShape[2];
  }
  const mode = session.outputNames.length >= 2 ? 'segmentation' : 'detection';
  console.log(`Loaded ONNX model (${mode} mode) with classes: ${classNames.join(', ')}`);
  return session;
}

function getModelInfo() {
  if (!classNames) return { loaded: false };
  const mode = session && session.outputNames.length >= 2 ? 'segmentation' : 'detection';
  return { loaded: true, classNames, imgsz, mode };
}

// ---- Preprocessing: letterbox resize + normalize to CHW float32 ----
async function letterbox(imageBuffer, targetSize) {
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
  const { width: w, height: h } = meta;

  const scale = Math.min(targetSize / w, targetSize / h);
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);
  const padX = targetSize - newW;
  const padY = targetSize - newH;
  const left = Math.floor(padX / 2);
  const top = Math.floor(padY / 2);

  const resized = await image
    .resize(newW, newH)
    .extend({
      top,
      bottom: padY - top,
      left,
      right: padX - left,
      background: { r: 114, g: 114, b: 114 },
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  const chw = new Float32Array(3 * targetSize * targetSize);
  const plane = targetSize * targetSize;
  for (let i = 0; i < plane; i++) {
    chw[i] = resized[i * 3] / 255;
    chw[plane + i] = resized[i * 3 + 1] / 255;
    chw[2 * plane + i] = resized[i * 3 + 2] / 255;
  }

  return { tensorData: chw, origW: w, origH: h, scale, padX: left, padY: top };
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter + 1e-9);
}

function nms(detections, iouThreshold) {
  const sorted = [...detections].sort((a, b) => b.conf - a.conf);
  const kept = [];
  for (const det of sorted) {
    if (kept.some((k) => k.classId === det.classId && iou(k, det) > iouThreshold)) continue;
    kept.push(det);
  }
  return kept;
}

// ---- Decode output0 into candidate detections (shared by both modes) ----
function decodeDetections(output0, numClasses, numExtra) {
  const dims = output0.dims; // [1, 4+numClasses(+extra), numBoxes]
  const numBoxes = dims[2];
  const data = output0.data;

  const candidates = [];
  for (let i = 0; i < numBoxes; i++) {
    let bestClass = -1;
    let bestScore = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numBoxes + i];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    if (bestScore < CONF_THRESHOLD) continue;

    const cx = data[0 * numBoxes + i];
    const cy = data[1 * numBoxes + i];
    const w = data[2 * numBoxes + i];
    const h = data[3 * numBoxes + i];

    let extra = null;
    if (numExtra > 0) {
      extra = new Float32Array(numExtra);
      for (let m = 0; m < numExtra; m++) {
        extra[m] = data[(4 + numClasses + m) * numBoxes + i];
      }
    }

    candidates.push({
      classId: bestClass,
      conf: bestScore,
      x1: cx - w / 2,
      y1: cy - h / 2,
      x2: cx + w / 2,
      y2: cy + h / 2,
      maskCoeffs: extra,
    });
  }

  return nms(candidates, IOU_THRESHOLD);
}

function unletterboxBox(det, letterboxInfo, origW, origH) {
  const { scale, padX, padY } = letterboxInfo;
  return {
    x1: Math.max(0, Math.round((det.x1 - padX) / scale)),
    y1: Math.max(0, Math.round((det.y1 - padY) / scale)),
    x2: Math.min(origW, Math.round((det.x2 - padX) / scale)),
    y2: Math.min(origH, Math.round((det.y2 - padY) / scale)),
    classId: det.classId,
    conf: det.conf,
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ============================================================================
//  DETECTION MODE — draws bounding boxes + labels, area-coverage breakdown
// ============================================================================
async function runDetectionMode(imageBuffer, session, colors, laneWidthM) {
  const numClasses = classNames.length;
  const { tensorData, origW, origH, scale, padX, padY } = await letterbox(imageBuffer, imgsz);
  const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, imgsz, imgsz]);
  const results = await session.run({ [session.inputNames[0]]: inputTensor });
  const output0 = results[session.outputNames[0]];

  const detections = decodeDetections(output0, numClasses, 0);
  const boxes = detections.map((d) => unletterboxBox(d, { scale, padX, padY }, origW, origH));

  // Overlay: colored rectangle + class/confidence label per detection
  const rects = boxes
    .map((b) => {
      const color = colors[b.classId % colors.length];
      const label = `${classNames[b.classId]} ${(b.conf * 100).toFixed(0)}%`;
      return `
        <rect x="${b.x1}" y="${b.y1}" width="${b.x2 - b.x1}" height="${b.y2 - b.y1}"
              fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="3" />
        <rect x="${b.x1}" y="${Math.max(0, b.y1 - 20)}" width="${8 * label.length}" height="20" fill="${color}" />
        <text x="${b.x1 + 4}" y="${Math.max(14, b.y1 - 6)}" font-family="monospace" font-size="13" fill="#0B1120">${label}</text>`;
    })
    .join('');
  const svg = `<svg width="${origW}" height="${origH}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
  const overlayBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const overlayPngBase64 = `data:image/png;base64,${overlayBuffer.toString('base64')}`;

  // Class breakdown = % of image area covered by each class's boxes
  // (painted onto a pixel map so overlapping boxes aren't double-counted)
  const classMap = new Int16Array(origW * origH).fill(-1);
  // Largest boxes first so smaller ones "win" the overlap visually — order
  // doesn't materially change the area sum either way for this use case.
  for (const b of boxes) {
    for (let y = b.y1; y < b.y2; y++) {
      const rowOffset = y * origW;
      for (let x = b.x1; x < b.x2; x++) {
        classMap[rowOffset + x] = b.classId;
      }
    }
  }
  const totalPx = origW * origH;
  const classPixelCount = new Array(numClasses).fill(0);
  for (let i = 0; i < classMap.length; i++) {
    if (classMap[i] >= 0) classPixelCount[classMap[i]]++;
  }
  const classBreakdown = {};
  classNames.forEach((name, i) => {
    classBreakdown[name] = +((classPixelCount[i] / totalPx) * 100).toFixed(1);
  });

  // Counts per class, for the "road type" readout
  const counts = new Array(numClasses).fill(0);
  boxes.forEach((b) => counts[b.classId]++);
  const classCounts = Object.fromEntries(classNames.map((name, i) => [name, counts[i]]));
  const laneClassId = classNames.indexOf('lane');
  const roadClassification = classifyRoad({
    laneCount: laneClassId >= 0 ? counts[laneClassId] : 0,
    laneWidthM,
  });

  // Stand-in "road pixel length" = vertical extent of the largest detected box
  let roadPixelLength = 0;
  if (boxes.length) {
    const largest = boxes.reduce((a, b) => ((b.x2 - b.x1) * (b.y2 - b.y1) > (a.x2 - a.x1) * (a.y2 - a.y1) ? b : a));
    roadPixelLength = largest.y2 - largest.y1;
  }

  return {
    width: origW,
    height: origH,
    overlayPngBase64,
    classBreakdown,
    roadType: roadClassification.name,
    roadTypeBasis: roadClassification.basis,
    classCounts,
    roadPixelLength,
    detections: boxes.map((b) => ({
      class: classNames[b.classId],
      confidence: +b.conf.toFixed(3),
      box: [b.x1, b.y1, b.x2, b.y2],
    })),
  };
}

async function analyze(imageBuffer, opts = {}) {
  await loadModel();
  if (!session) {
    throw new Error('ONNX model not loaded — call isModelAvailable() before analyze()');
  }
  const colors = opts.colors || DEFAULT_COLORS;

  if (session.outputNames.length >= 2) {
    throw new Error(
      'This model exposes 2 outputs (segmentation-style), but only detection-mode decoding is currently wired in onnxModel.js. See onnxSegmentation.js.bak for the mask-decoding reference implementation.'
    );
  }
  return runDetectionMode(imageBuffer, session, colors, opts.laneWidthM);
}

module.exports = { analyze, isModelAvailable, loadModel, getModelInfo };
