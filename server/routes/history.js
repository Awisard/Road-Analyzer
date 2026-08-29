const express = require('express');
const historyStore = require('../services/historyStore');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.json(await historyStore.listAnalyses());
  } catch (error) {
    console.error('History list failed:', error.message);
    res.status(503).json({ error: 'History is unavailable', detail: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const analysis = await historyStore.getAnalysis(req.params.id);
    if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
    res.json(historyStore.serializeHistory(analysis));
  } catch (error) {
    console.error('History item failed:', error.message);
    res.status(503).json({ error: 'History is unavailable', detail: error.message });
  }
});

router.get('/:id/image/:type', async (req, res) => {
  if (!['original', 'overlay'].includes(req.params.type)) {
    return res.status(400).json({ error: 'Image type must be original or overlay' });
  }
  try {
    await historyStore.streamAnalysisImage(req.params.id, req.params.type, res);
  } catch (error) {
    console.error('History image failed:', error.message);
    res.status(503).json({ error: 'History image is unavailable', detail: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await historyStore.deleteAnalysis(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Analysis not found' });
    res.status(204).end();
  } catch (error) {
    console.error('History delete failed:', error.message);
    res.status(503).json({ error: 'History is unavailable', detail: error.message });
  }
});

module.exports = router;
