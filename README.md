# Road Analyzer

Upload a drone photo of a road, get a segmentation overlay (carriageway / shoulder /
sidewalk / divider), a class breakdown, and — if you provide flight altitude + camera
specs — an estimated real-world road length.

## Current trained model

`training/results/yolov12_custom/` holds your actual training run: a YOLOv12n
**detector** (not segmenter) with two classes — `bare-roads` (unpaved) and
`filled-roads` (paved/marked) — trained on ~250 images per class at `imgsz: 360`.

**Before relying on it:** `results.csv` shows training stopped at epoch 6 of a
planned 50 (likely a Colab session cutoff, not convergence) — metrics were still
swinging between epochs, not leveling off. mAP50 hit ~0.96 that early on a 2-class,
whole-frame task with a small dataset, which is more often a sign the task was easy
to shortcut than that it robustly generalizes. Worth resuming training to the full
50 epochs and testing on images the model has never seen before trusting it.

## Connect it (one-time)

```bash
cd training
python scripts/export_onnx.py \
  --weights results/yolov12_custom/weights/best.pt \
  --out ../server/models \
  --imgsz 360
cd ../server
npm install
npm start
```

`--imgsz 360` matters — it must match training (`args.yaml` in your results folder),
not the default 640, or predictions will be wrong.

## Structure

```
road-analyzer/
├── server/                  Node.js/Express backend
│   ├── index.js             App entry point
│   ├── routes/analyze.js    POST /api/analyze — upload → inference → response
│   └── services/
│       ├── segmentation.js  ⚠️ PLACEHOLDER model — swap for your trained model
│       └── measurement.js   Pixel → real-world-meters conversion (GSD formula)
├── client/                  Static frontend (no build step)
│   ├── index.html
│   ├── style.css
│   └── app.js
└── training/                Python: dataset conversion + YOLOv12-seg training
    ├── scripts/coco_to_yolo_seg.py
    ├── scripts/train.py
    └── README.md            Step-by-step training instructions
```

## Run it

```bash
cd server
npm install
npm start
```

Then open `http://localhost:4000` — the server also serves the `client/` folder as
static files, so there's nothing separate to run on the frontend.

## Current state: placeholder model

`services/segmentation.js` does **not** run a real trained model yet — it draws mock
horizontal bands (sidewalk / shoulder / carriageway / divider) so the full pipeline
(upload → inference → overlay → stats → UI) is wired up and demonstrable end to end.
The file has a comment block at the top marking exactly what to replace once your
model is trained.

## Training the real model

See `training/README.md` for the full walkthrough. Short version: your COCO-labeled
dataset gets converted to YOLO-seg format, then fine-tuned as a YOLOv12 segmentation
model in Python, then exported to ONNX.

```bash
cd training
pip install -r requirements.txt
python scripts/coco_to_yolo_seg.py --coco-json ... --images-dir ... --output-dir ./data/yolo_dataset
python scripts/train.py --data ./data/yolo_dataset/data.yaml
```

## Connecting a trained checkpoint

This part is now built and auto-detects your model type (see
`server/services/onnxModel.js`) — detection-only (boxes, like your current
bare-roads/filled-roads model) or full segmentation (pixel masks, if you train one
later):

```bash
cd training
python scripts/export_onnx.py --weights /path/to/best.pt --out ../server/models
cd ../server
npm install   # pulls in onnxruntime-node
npm start
```

That drops `best.onnx` + `classes.json` into `server/models/` (see
`server/models/README.md`). On startup, `services/segmentation.js` checks whether
those files exist — if so, every request runs real inference through
`services/onnxModel.js`, which auto-detects detection-vs-segmentation export shape
(letterbox preprocessing → ONNX inference → NMS → box or mask decoding depending on
what the model outputs); if not, it falls back to the placeholder mock bands, so the
app runs either way. The frontend's status badge shows which mode is active.
Nothing else in the app needed to change — both paths return the same
`{ overlayPngBase64, classBreakdown, roadType, roadPixelLength }` shape.

## The road-length measurement, honestly

A single photo has no built-in scale. The math in `measurement.js` (Ground Sample
Distance) only gives a real-world length because you're supplying **drone altitude +
camera sensor width + focal length**, and it assumes a straight-down (nadir) shot over
roughly flat ground. Angled shots or unknown camera specs will only give a relative
pixel-based estimate, not meters.
