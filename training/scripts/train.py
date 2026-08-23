"""
Train a YOLOv12 segmentation model on the converted dataset, then export it
to ONNX so the Node.js backend (server/services/segmentation.js) can run it
via onnxruntime-node.

Usage:
    python train.py --data /path/to/yolo_dataset/data.yaml --epochs 100

    # quick smoke test on CPU with a tiny model/subset first:
    python train.py --data ... --model yolo12n-seg.pt --epochs 5 --imgsz 640

Model size guide (n < s < m < l < x, trades speed for accuracy):
    yolo12n-seg.pt  fastest, least accurate — good for a first end-to-end test
    yolo12s-seg.pt  good default starting point
    yolo12m-seg.pt / yolo12l-seg.pt  more accurate, needs a real GPU
"""

import argparse
from pathlib import Path

from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", required=True, help="Path to data.yaml produced by coco_to_yolo_seg.py")
    parser.add_argument("--model", default="yolo12n-seg.pt", help="Base checkpoint to fine-tune from")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--project", default="runs/road-analyzer", help="Where training runs are saved")
    parser.add_argument("--name", default="seg", help="Run name")
    parser.add_argument("--export-onnx", action="store_true", default=True,
                         help="Export best.pt to ONNX after training (default: on)")
    args = parser.parse_args()

    model = YOLO(args.model)  # loads pretrained COCO weights, fine-tunes on your classes

    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.project,
        name=args.name,
    )

    # Validate on the held-out split
    metrics = model.val()
    print("Validation metrics:", metrics.results_dict)

    if args.export_onnx:
        best_pt = Path(args.project) / args.name / "weights" / "best.pt"
        print(f"Exporting {best_pt} to ONNX...")
        best_model = YOLO(str(best_pt))
        onnx_path = best_model.export(format="onnx", opset=12, simplify=True)
        print(f"ONNX model written to: {onnx_path}")
        print("Copy this file into server/models/ and point segmentation.js at it.")


if __name__ == "__main__":
    main()
