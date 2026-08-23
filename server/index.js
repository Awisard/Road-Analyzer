const path = require('path');
const express = require('express');
const cors = require('cors');
const analyzeRouter = require('./routes/analyze');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve the static frontend (client/) directly — no build step required.
app.use(express.static(path.join(__dirname, '..', 'client')));

app.use('/api/analyze', analyzeRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Road Analyzer server running at http://localhost:${PORT}`);
});
