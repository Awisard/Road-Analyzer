"""
Convert a COCO-format instance-segmentation dataset into YOLO-seg format
(what Ultralytics' YOLOv12-seg training expects).

COCO layout expected (typical exporter output, e.g. from CVAT/Labelbox/Roboflow):
    annotations.json
    images/
        img001.jpg
        img002.jpg
        ...

YOLO-seg layout produced:
    <output_dir>/
        images/train/*.jpg
        images/val/*.jpg
        labels/train/*.txt
        labels/val/*.txt
        data.yaml

YOLO-seg label line format (all coordinates normalized 0-1):
    <class_id> x1 y1 x2 y2 x3 y3 ... xn yn

Usage:
    python coco_to_yolo_seg.py \
        --coco-json /path/to/annotations.json \
        --images-dir /path/to/images \
        --output-dir /path/to/yolo_dataset \
        --val-split 0.15

Limitations (read before trusting the output blindly):
    - RLE-encoded segmentations (crowd masks, "iscrowd": 1) are skipped, since
      decoding them needs pycocotools and produces pixel masks, not polygons.
      If your dataset relies heavily on RLE masks, decode+re-polygonize with
      pycocotools first, or extend `polygon_from_annotation` below.
    - If a single instance has multiple disjoint polygons (COCO allows this
      for objects split by an obstruction), each polygon is written as its
      own YOLO line under the same class. This is a simplification — the
      object is still detected as separate blobs rather than one instance
      with a hole. Fine for coverage stats (e.g. % of image that's
      carriageway); revisit if you need strict per-instance counts.
"""

import argparse
import json
import random
import shutil
from pathlib import Path
from collections import defaultdict


def polygon_from_annotation(ann):
    """Return a list of polygons (each a flat [x1,y1,x2,y2,...] list) for one
    COCO annotation, or [] if it can't be represented as polygons (RLE)."""
    seg = ann.get("segmentation")
    if not seg:
        return []
    if isinstance(seg, dict):  # RLE — not handled here, see module docstring
        return []
    # COCO polygon segmentation: list of [x1,y1,x2,y2,...] per part
    return [poly for poly in seg if len(poly) >= 6]  # need >= 3 points


def convert(coco_json_path, images_dir, output_dir, val_split, seed=42):
    coco_json_path = Path(coco_json_path)
    images_dir = Path(images_dir)
    output_dir = Path(output_dir)

    with open(coco_json_path) as f:
        coco = json.load(f)

    categories = sorted(coco["categories"], key=lambda c: c["id"])
    cat_id_to_yolo_idx = {c["id"]: i for i, c in enumerate(categories)}
    class_names = [c["name"] for c in categories]

    images_by_id = {img["id"]: img for img in coco["images"]}
    anns_by_image = defaultdict(list)
    skipped_rle = 0
    for ann in coco["annotations"]:
        if ann.get("iscrowd", 0) == 1 or isinstance(ann.get("segmentation"), dict):
            skipped_rle += 1
            continue
        anns_by_image[ann["image_id"]].append(ann)

    image_ids = list(images_by_id.keys())
    random.Random(seed).shuffle(image_ids)
    n_val = max(1, int(len(image_ids) * val_split))
    val_ids = set(image_ids[:n_val])

    for split in ("train", "val"):
        (output_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (output_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    written, missing_images = 0, 0
    for image_id, img_info in images_by_id.items():
        split = "val" if image_id in val_ids else "train"
        file_name = img_info["file_name"]
        src_path = images_dir / file_name
        if not src_path.exists():
            missing_images += 1
            continue

        dst_img_path = output_dir / "images" / split / Path(file_name).name
        shutil.copy2(src_path, dst_img_path)

        w, h = img_info["width"], img_info["height"]
        lines = []
        for ann in anns_by_image.get(image_id, []):
            yolo_class = cat_id_to_yolo_idx[ann["category_id"]]
            for poly in polygon_from_annotation(ann):
                norm = []
                for i in range(0, len(poly), 2):
                    x, y = poly[i], poly[i + 1]
                    norm.append(f"{x / w:.6f}")
                    norm.append(f"{y / h:.6f}")
                lines.append(f"{yolo_class} " + " ".join(norm))

        label_path = output_dir / "labels" / split / (Path(file_name).stem + ".txt")
        label_path.write_text("\n".join(lines))
        written += 1

    data_yaml = output_dir / "data.yaml"
    data_yaml.write_text(
        "path: {}\n"
        "train: images/train\n"
        "val: images/val\n"
        "nc: {}\n"
        "names: {}\n".format(output_dir.resolve(), len(class_names), class_names)
    )

    print(f"Wrote {written} image/label pairs ({len(val_ids)} val, {written - len(val_ids)} train).")
    if skipped_rle:
        print(f"Skipped {skipped_rle} RLE/crowd annotations (see docstring).")
    if missing_images:
        print(f"Warning: {missing_images} images referenced in the JSON were not found in --images-dir.")
    print(f"Classes ({len(class_names)}): {class_names}")
    print(f"data.yaml written to {data_yaml}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--coco-json", required=True, help="Path to COCO annotations JSON")
    parser.add_argument("--images-dir", required=True, help="Directory containing the source images")
    parser.add_argument("--output-dir", required=True, help="Where to write the YOLO-seg dataset")
    parser.add_argument("--val-split", type=float, default=0.15, help="Fraction of images held out for validation")
    args = parser.parse_args()

    convert(args.coco_json, args.images_dir, args.output_dir, args.val_split)
