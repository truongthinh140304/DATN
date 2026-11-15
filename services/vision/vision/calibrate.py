"""Calibrate real camera polygons/plate regions against existing API spot IDs."""

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

from .config import parse_source, save_rois
from .domain import ParkingRoi
from .geometry import is_simple_polygon
from .layout import draw_layout_guides, grid_rois
from .source import open_video_source


def select_spots(
    items: list[dict], codes: list[str] | None, ids: list[str] | None
) -> list[dict]:
    selected = []
    for value in ids or codes or []:
        matches = (
            [item for item in items if item["id"] == value]
            if ids
            else [item for item in items if item["code"].upper() == value.upper()]
        )
        if len(matches) != 1:
            raise ValueError(
                f"Spot {value!r}: expected one active match, found {len(matches)}; use --spot-ids if codes repeat"
            )
        selected.append(matches[0])
    if not selected or len({item["id"] for item in selected}) != len(selected):
        raise ValueError("Select at least one spot without duplicate mappings")
    return selected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--codes", nargs="+")
    group.add_argument("--spot-ids", nargs="+")
    parser.add_argument("--source", default="2")
    parser.add_argument(
        "--camera-name",
        help="Exact webcam device name; never falls back to another camera",
    )
    parser.add_argument(
        "--backend",
        choices=["auto", "dshow", "msmf"],
        default="dshow" if sys.platform == "win32" else "auto",
    )
    parser.add_argument("--camera-id", default="usb-parking-camera")
    parser.add_argument("--api-url", default="http://localhost:4000")
    parser.add_argument("--output-dir", default="config")
    parser.add_argument(
        "--roi-mode",
        choices=["rectangle", "polygon", "grid"],
        default="rectangle",
        help="Rectangle is easiest for one experimental vehicle",
    )
    parser.add_argument(
        "--columns",
        type=int,
        default=None,
        help="Grid guide columns; default one row across selected spots",
    )
    args = parser.parse_args()
    key = os.environ.get("VISION_API_KEY", "")
    if not key:
        raise ValueError(
            "VISION_API_KEY is required; use npm run vision:setup from repository root"
        )
    import requests
    import cv2
    import numpy as np

    response = requests.get(
        f"{args.api_url.rstrip('/')}/api/vision/spots",
        headers={"x-vision-api-key": key},
        timeout=10,
    )
    response.raise_for_status()
    spots = select_spots(response.json()["items"], args.codes, args.spot_ids)
    guides = (
        grid_rois(spots, args.columns or len(spots)) if args.roi_mode == "grid" else []
    )
    print(
        json.dumps(
            {
                "calibrationSpots": [
                    {"code": item["code"], "spotId": item["id"]} for item in spots
                ]
            }
        ),
        flush=True,
    )
    capture = open_video_source(
        parse_source(args.source), backend=args.backend, camera_name=args.camera_name
    )
    window = "DATN calibration - SPACE freeze frame, Q cancel"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window, 1100, 750)
    try:
        print(
            "Fix the camera and vehicle position. SPACE freezes a frame for calibration; Q cancels.",
            flush=True,
        )
        while True:
            ok, frame = capture.read()
            if not ok or frame is None:
                raise ValueError("Cannot read a real camera frame")
            canvas = frame.copy()
            if guides:
                draw_layout_guides(canvas, guides)
            cv2.putText(
                canvas,
                "SPACE: confirm visible guide positions | Q: cancel"
                if guides
                else "SPACE: freeze frame for calibration | Q: cancel",
                (10, 28),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (0, 255, 255),
                2,
            )
            cv2.imshow(window, canvas)
            key_code = cv2.waitKey(20) & 0xFF
            if (
                key_code in (27, ord("q"))
                or cv2.getWindowProperty(window, cv2.WND_PROP_VISIBLE) < 1
            ):
                return 1
            if key_code == ord(" "):
                break
    finally:
        capture.release()
        cv2.destroyAllWindows()

    height, width = frame.shape[:2]
    rois = []
    plate_regions = []
    try:
        for spot in spots:
            points = []
            if args.roi_mode == "grid":
                guide = next(roi for roi in guides if roi.spot_id == spot["id"])
                points = [
                    (round(x * width), round(y * height)) for x, y in guide.polygon
                ]
            if args.roi_mode == "rectangle":
                rectangle_title = (
                    f"Zone {spot['code']} - DRAG around entire vehicle, ENTER confirm"
                )
                print(
                    f"Drag ONE rectangle around the entire vehicle/observation zone {spot['code']}, then ENTER. The plate is selected in the NEXT window.",
                    flush=True,
                )
                cv2.namedWindow(rectangle_title, cv2.WINDOW_NORMAL)
                cv2.resizeWindow(rectangle_title, 1100, 750)
                x, y, w, h = cv2.selectROI(rectangle_title, frame, False, False)
                cv2.destroyWindow(rectangle_title)
                if w <= 0 or h <= 0:
                    return 1
                points = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
            name = f"Draw zone {spot['code']} - left click vertices, ENTER confirm, Q cancel"

            def on_mouse(event, x, y, _flags, _data):
                if event == cv2.EVENT_LBUTTONDOWN:
                    points.append((x, y))
                elif event == cv2.EVENT_RBUTTONDOWN and points:
                    points.pop()

            if args.roi_mode == "polygon":
                cv2.namedWindow(name, cv2.WINDOW_NORMAL)
                cv2.resizeWindow(name, 1100, 750)
                cv2.setMouseCallback(name, on_mouse)
                print(
                    f"Draw {spot['code']}: left-click vertices in order, right-click undo, R reset, ENTER confirm.",
                    flush=True,
                )
            while args.roi_mode == "polygon":
                canvas = frame.copy()
                if points:
                    cv2.polylines(
                        canvas,
                        [np.array(points, dtype=np.int32)],
                        True,
                        (0, 255, 255),
                        2,
                    )
                cv2.imshow(name, canvas)
                code = cv2.waitKey(20) & 0xFF
                if (
                    code in (27, ord("q"))
                    or cv2.getWindowProperty(name, cv2.WND_PROP_VISIBLE) < 1
                ):
                    return 1
                if code == ord("r"):
                    points.clear()
                if code in (10, 13):
                    if is_simple_polygon(points):
                        break
                    print(
                        "Invalid polygon: edges cross or area is empty. Press R and draw again in clockwise order.",
                        flush=True,
                    )
            if args.roi_mode == "polygon":
                cv2.destroyWindow(name)
            rois.append(
                ParkingRoi(
                    spot["id"],
                    spot["code"],
                    tuple((x / width, y / height) for x, y in points),
                )
            )
            title = (
                f"Plate {spot['code']} - drag tightly, ENTER confirm, ESC skip empty bay"
                if guides
                else f"Plate region {spot['code']} - drag rectangle, ENTER confirm, ESC cancel"
            )
            print(
                f"Select a tight plate rectangle for {spot['code']}; manual OCR experiment, not an automatic plate detector.",
                flush=True,
            )
            preview = frame.copy()
            if guides:
                draw_layout_guides(preview, guides)
            cv2.namedWindow(title, cv2.WINDOW_NORMAL)
            cv2.resizeWindow(title, 1100, 750)
            x, y, w, h = cv2.selectROI(title, preview, False, False)
            cv2.destroyWindow(title)
            if w <= 0 or h <= 0:
                if guides:
                    print(
                        f"No plate region for empty bay {spot['code']}; occupancy still monitored. Use R in the running app to select a plate after moving the vehicle.",
                        flush=True,
                    )
                    continue
                return 1
            plate_regions.append(
                [
                    float(x / width),
                    float(y / height),
                    float((x + w) / width),
                    float((y + h) / height),
                ]
            )
    finally:
        cv2.destroyAllWindows()

    if not plate_regions:
        print(
            "No plate region selected; calibration not saved. Place the car in one visible bay and select its plate, skip only the empty bays.",
            flush=True,
        )
        return 1

    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    # Save only coordinates/config, never camera images or the API key. Back up
    # previous local calibration only after the whole new calibration succeeds.
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    for filename in ("vision.json", "spots.json", "parking_rois.json", "plates.json"):
        existing = output / filename
        if existing.exists():
            shutil.copy2(existing, output / f"{filename}.{stamp}.bak")
    save_rois(output / "parking_rois.json", args.camera_id, rois, width, height)
    settings = {
        "cameraId": args.camera_id,
        "source": parse_source(args.source),
        "cameraName": args.camera_name,
        "videoBackend": args.backend,
        "roiConfig": "parking_rois.json",
        "plateConfig": "plates.json",
        "model": str(Path("models/yolo11n.pt").resolve())
        if Path("models/yolo11n.pt").is_file()
        else "yolo11n.pt",
        "device": "cpu",
        "imageSize": 640,
        "detectorConfidence": 0.25,
        "reportIntervalSeconds": 3,
        "apiUrl": args.api_url,
    }
    plates = {
        "detector": {
            "mode": "manual",
            "modelPath": None,
            "manualRegions": plate_regions,
        },
        "preprocess": {
            "scale": 2.0,
            "grayscale": True,
            "clahe": True,
            "min_blur": 35.0,
        },
        "ocr": {
            "device": "cpu",
            "text_detection_model_name": "PP-OCRv5_mobile_det",
            "text_recognition_model_name": "en_PP-OCRv5_mobile_rec",
        },
        "consensus": {"samples": 3, "window": 7, "ttl": 20.0, "confidence": 0.7},
    }
    mapping = {
        "cameraId": args.camera_id,
        "spots": [{"code": item["code"], "spotId": item["id"]} for item in spots],
    }
    for filename, payload in (
        ("vision.json", settings),
        ("plates.json", plates),
        ("spots.json", mapping),
    ):
        (output / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(
        "Calibration saved. Run npm run vision:run from D:\\DATN. No parking/business records were changed.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
