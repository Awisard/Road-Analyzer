const express = require('express');
const multer = require('multer');
const { analyzeImage } = require('../services/segmentation');
const onnxModel = require('../services/onnxModel');
const { estimateGSD, pixelsToMeters, DRONE_PRESETS } = require('../services/measurement');
const historyStore = require('../services/historyStore');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/presets', (req, res) => {
  res.json(DRONE_PRESETS);
});

router.get('/model-info', async (req, res) => {
  if (!onnxModel.isModelAvailable()) {
    return res.json({ loaded: false, mode: 'placeholder' });
  }
  await onnxModel.loadModel();
  res.json(onnxModel.getModelInfo());
});

router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded. Field name must be "image".' });
    }

    const altitudeM = parseFloat(req.body.altitudeM);
    const sensorWidthMm = parseFloat(req.body.sensorWidthMm);
    const focalLengthMm = parseFloat(req.body.focalLengthMm);
    const laneWidthM = parseFloat(req.body.laneWidthM);

    const result = await analyzeImage(req.file.buffer, { laneWidthM });

    const gsd = estimateGSD({
      sensorWidthMm,
      focalLengthMm,
      altitudeM,
      imageWidthPx: result.width,
    });

    const roadLengthM = gsd ? pixelsToMeters(result.roadPixelLength, gsd) : null;
    const response = {
      imageWidth: result.width,
      imageHeight: result.height,
      overlayPngBase64: result.overlayPngBase64,
      classBreakdown: result.classBreakdown,
      roadType: result.roadType,
      roadTypeBasis: result.roadTypeBasis,
      classCounts: result.classCounts,
      measurement: {
        gsdMetersPerPixel: gsd ? +gsd.toFixed(5) : null,
        roadLengthM,
        note: gsd
          ? null
          : 'Provide altitude, sensor width and focal length to convert pixels to real-world meters.',
      },
    };

    let historyId = null;
    try {
      const saved = await historyStore.saveAnalysis({
        originalBuffer: req.file.buffer,
        originalContentType: req.file.mimetype,
        originalName: req.file.originalname,
        result: { ...result, measurement: response.measurement },
        parameters: { altitudeM, sensorWidthMm, focalLengthMm, laneWidthM },
      });
      historyId = saved._id.toString();
    } catch (historyError) {
      console.error('Analysis completed but history save failed:', historyError.message);
    }

    res.json({ ...response, historyId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Analysis failed', detail: err.message });
  }
});

module.exports = router;
