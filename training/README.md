# Training pipeline (Python)

Converts your COCO-labeled dataset to YOLO-seg format and fine-tunes a YOLOv12
segmentation model on it, then exports to ONNX for the Node backend.

## Setup

```bash
cd training
python -m venv venv && source venv/bin/activate   # or your preferred env manager
pip install -r requirements.txt
```

## 1. Convert COCO → YOLO-seg

```bash
python scripts/coco_to_yolo_seg.py \
  --coco-json /path/to/annotations.json \
  --images-dir /path/to/images \
  --output-dir ./data/yolo_dataset \
  --val-split 0.15
```

This writes `./data/yolo_dataset/{images,labels}/{train,val}` and a `data.yaml`
Ultralytics can train directly against. Check the printed class list and image
counts before moving on — a silently-wrong category mapping is the most common
way this kind of conversion goes sideways.

**Before trusting the conversion:** open a couple of the generated label `.txt`
files next to their images (Ultralytics' `yolo` CLI has a quick plotting utility,
or just eyeball the normalized coordinates) to confirm polygons land where you'd
expect. Read the limitations noted at the top of `coco_to_yolo_seg.py` — RLE/crowd
annotations are skipped, and multi-part instances are split into separate lines.

## 2. Train

```bash
python scripts/train.py \
  --data ./data/yolo_dataset/data.yaml \
  --model yolo12n-seg.pt \
  --epochs 100 \
  --imgsz 640
```

Start with the `n` (nano) checkpoint and a handful of epochs just to confirm the
pipeline runs end to end, then scale up (`yolo12s-seg.pt` / more epochs / a GPU)
once you trust the data. Training metrics and sample predictions land in
`runs/road-analyzer/seg/`.

The script validates on the held-out split and exports `best.pt` to ONNX
automatically at the end.

## 3. Wiring the export into the Node backend — read this before you assume it's a drop-in swap

The current placeholder in `server/services/segmentation.js` just returns a
colored PNG mask. A real YOLO-seg ONNX model's raw output is **not** a mask
image — it's two tensors (per-detection boxes + mask coefficients, and a set of
prototype masks) that need non-max suppression and a matrix multiply to turn
into per-pixel class masks, before you get something you can render as an
overlay. That postprocessing step is the next piece of work — happy to build
the Node-side ONNX inference + decoding logic (via `onnxruntime-node`) once you
have a trained `best.onnx` to test it against.
