"""
Export an existing Ultralytics YOLO .pt checkpoint to ONNX, ready to drop into
the Node backend (server/models/best.onnx).

Usage:
    python export_onnx.py --weights /path/to/best.pt --out ../../server/models
"""

import argparse
import json
import shutil
from pathlib import Path

from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", required=True, help="Path to trained .pt checkpoint")
    parser.add_argument("--out", default="../../server/models", help="Output directory for the Node backend")
    parser.add_argument("--imgsz", type=int, default=640,
                         help="MUST match the imgsz the model was trained with (check args.yaml in your training results folder)")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    model = YOLO(args.weights)
    onnx_path = model.export(format="onnx", opset=12, simplify=True, imgsz=args.imgsz)

    dest = out_dir / "best.onnx"
    shutil.copy2(onnx_path, dest)
    print(f"ONNX model copied to {dest}")

    # class names, in index order — the Node side needs this to label masks
    names = model.names  # {0: 'carriageway', 1: 'shoulder', ...}
    class_names = [names[i] for i in range(len(names))]
    classes_path = out_dir / "classes.json"
    classes_path.write_text(json.dumps({"names": class_names, "imgsz": args.imgsz, "task": model.task}, indent=2))
    print(f"Class list written to {classes_path}")
    print(f"Classes: {class_names}")

    print("\nNext: cd server && npm install onnxruntime-node && npm start")


if __name__ == "__main__":
    main()
