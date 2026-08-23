# server/models/

Drop your exported model here and the backend picks it up automatically —
no code changes needed:

```
server/models/
├── best.onnx        Your trained model, exported to ONNX
└── classes.json      { "names": ["bare-roads", "filled-roads"], "imgsz": 360 }
```

## How to generate these two files

From a trained Ultralytics YOLO checkpoint (`best.pt`):

```bash
cd training
python scripts/export_onnx.py --weights /path/to/best.pt --out ../server/models --imgsz 360
```

(`--imgsz 360` matches the `yolov12_custom` run's training config — check your
own `args.yaml` if you trained differently.) This writes both `best.onnx` and
`classes.json`, with class names read directly from the checkpoint in the
order they were trained (`model.names`), so there's no manual step to get
that mapping right.

## Then

```bash
cd server
npm install        # pulls in onnxruntime-node
npm start
```

On startup, `routes/analyze.js` → `services/segmentation.js` checks whether
`best.onnx` + `classes.json` exist:
- **Present** → every `/api/analyze` request runs real inference through
  `services/onnxModel.js`.
- **Missing** → falls back to the placeholder mock-band generator, so the app
  still runs without a trained model.

`onnxModel.js` auto-detects which kind of export it's looking at from the
ONNX session's output count — one output tensor means a plain **detection**
model (boxes + class scores, decoded into labeled bounding-box overlays —
this is what the current `bare-roads` / `filled-roads` model produces); two
output tensors would mean a **segmentation** export (mask coefficients +
prototypes), which isn't wired up yet — see the note in `onnxModel.js`'s
`analyze()` function and `onnxSegmentation.js.bak` for the mask-decoding
reference if you train a segmentation model later.

The frontend's top-right status badge reflects which mode is active
(`MODEL: TRAINED (n classes)` vs `MODEL: PLACEHOLDER-DEMO`) by calling
`GET /api/analyze/model-info`.

## A note on trust, not just plumbing

Getting inference wired up end-to-end doesn't mean the outputs are right.
Before relying on the class-breakdown percentages or length estimates for
anything real: run a handful of test images through the UI, sanity-check the
overlay against what you can see by eye, and compare against your model's
validation mAP from training — a model with mediocre or still-converging mAP
(check `results.csv` from your training run) will produce a working-looking
overlay that's still wrong.
