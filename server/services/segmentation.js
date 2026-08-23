const sharp = require('sharp');
const onnxModel = require('./onnxModel');

/**
 * ============================================================================
 *  analyzeImage() is the single entry point the rest of the app calls.
 *
 *  If a real trained model is present at server/models/best.onnx (+
 *  classes.json), it's used automatically via onnxModel.js, which auto-detects
 *  whether the export is detection-only (bounding boxes — this project's
 *  current bare-roads/filled-roads model) or full segmentation (pixel masks),
 *  and decodes accordingly. If no model is present, this falls back to
 *  analyzeImagePlaceholder() below, so the app still runs end to end without
 *  one. All paths return the same shape:
 *  { overlayPngBase64, classBreakdown, roadType, roadPixelLength }.
 * ============================================================================
 */
async function analyzeImage(imageBuffer, opts = {}) {
  if (onnxModel.isModelAvailable()) {
    return onnxModel.analyze(imageBuffer, opts);
  }
  return analyzeImagePlaceholder(imageBuffer);
}

const CLASS_COLORS = {
  sidewalk: '#4FD1C5',     // teal
  shoulder: '#C9A227',     // ochre
  carriageway: '#2E5EAA',  // steel blue (asphalt)
  divider: '#E24B4B',      // red
};

async function analyzeImagePlaceholder(imageBuffer) {
  const image = sharp(imageBuffer);
  const { width, height } = await image.metadata();

  // --- Fake band layout standing in for a real per-pixel segmentation mask ---
  // Top/bottom strips = sidewalk, next bands = shoulder, center = carriageway,
  // with a thin divider line down the middle third of the frame.
  const sidewalkH = Math.round(height * 0.12);
  const shoulderH = Math.round(height * 0.1);
  const carriagewayH = height - 2 * sidewalkH - 2 * shoulderH;
  const dividerW = Math.max(2, Math.round(width * 0.008));

  const bands = [
    { y: 0, h: sidewalkH, color: CLASS_COLORS.sidewalk, cls: 'sidewalk' },
    { y: sidewalkH, h: shoulderH, color: CLASS_COLORS.shoulder, cls: 'shoulder' },
    { y: sidewalkH + shoulderH, h: carriagewayH, color: CLASS_COLORS.carriageway, cls: 'carriageway' },
    { y: sidewalkH + shoulderH + carriagewayH, h: shoulderH, color: CLASS_COLORS.shoulder, cls: 'shoulder' },
    { y: height - sidewalkH, h: sidewalkH, color: CLASS_COLORS.sidewalk, cls: 'sidewalk' },
  ];

  const rects = bands
    .map((b) => `<rect x="0" y="${b.y}" width="${width}" height="${b.h}" fill="${b.color}" fill-opacity="0.45" />`)
    .join('');

  const dividerRect = `<rect x="${(width - dividerW) / 2}" y="${sidewalkH + shoulderH}" width="${dividerW}" height="${carriagewayH}" fill="${CLASS_COLORS.divider}" fill-opacity="0.85" />`;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${rects}${dividerRect}</svg>`;

  const overlayBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const overlayPngBase64 = `data:image/png;base64,${overlayBuffer.toString('base64')}`;

  const totalPx = width * height;
  const classPx = {
    sidewalk: sidewalkH * width * 2,
    shoulder: shoulderH * width * 2,
    carriageway: carriagewayH * width - dividerW * carriagewayH,
    divider: dividerW * carriagewayH,
  };
  const classBreakdown = Object.fromEntries(
    Object.entries(classPx).map(([cls, px]) => [cls, +((px / totalPx) * 100).toFixed(1)])
  );

  return {
    width,
    height,
    overlayPngBase64,
    classBreakdown,
    roadType: 'divided carriageway (placeholder inference)',
    // Vertical extent of the carriageway band — stands in for the road's
    // pixel-length along the drone's flight line until real mask analysis
    // (e.g. skeletonizing the carriageway mask) replaces it.
    roadPixelLength: carriagewayH,
  };
}

module.exports = { analyzeImage, CLASS_COLORS };

