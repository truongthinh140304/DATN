"""Local webcam experiment: vehicle YOLO and independent manual-region OCR.

No parking assignment, API writes, image recording or automatic plate detector.
"""

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path

from .config import parse_source
from .detector import DetectorSettings, YoloVehicleDetector
from .plate_ocr import PaddlePlateOcr
from .plate_preprocess import PreprocessSettings, crop_original, preprocess
from .plate_temporal import PlateConsensus
from .plate_text import plausible_plate
from .source import open_video_source


def read_crop(engine, frame, box):
    image, sharp = preprocess(crop_original(frame, box), PreprocessSettings())
    return (engine.read(image) if sharp else None), sharp


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        default="0",
        help="Camera index; default 0 for the local webcam. Use another index if your USB webcam is listed elsewhere.",
    )
    parser.add_argument(
        "--backend",
        choices=["auto", "dshow", "msmf"],
        default="dshow" if sys.platform == "win32" else "auto",
        help="Default: DirectShow for USB/local webcams on Windows; auto on other systems",
    )
    parser.add_argument("--model", default="models/yolo11n.pt")
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument(
        "--seconds", type=float, default=0, help="Stop after N seconds, 0 until Q"
    )
    args = parser.parse_args()
    import cv2

    Path(args.model).parent.mkdir(parents=True, exist_ok=True)
    detector = YoloVehicleDetector(
        DetectorSettings(model=args.model, confidence=args.confidence)
    )
    backend = {"dshow": cv2.CAP_DSHOW, "msmf": cv2.CAP_MSMF}.get(args.backend)
    capture = open_video_source(
        parse_source(args.source),
        (lambda source: cv2.VideoCapture(source, backend))
        if backend is not None
        else None,
    )
    print(
        json.dumps(
            {
                "type": "CAMERA_SOURCE",
                "source": parse_source(args.source),
                "backend": capture.getBackendName(),
            }
        ),
        flush=True,
    )
    window = "DATN - Webcam vehicle + handwritten plate experiment"
    pool = ThreadPoolExecutor(max_workers=1)
    pending = pool.submit(PaddlePlateOcr, {})
    engine = None
    phase = "loading"
    consensus = PlateConsensus(ttl=15.0)
    box = None
    result_box = None
    ocr_text = "OCR loading models..."
    ocr_status = "UNREADABLE"
    last_ocr_at = 0.0
    last_started = 0.0
    last_log = 0.0
    start = time.monotonic()
    print(
        "CAMERA_DEMO: local preview only. Hold vehicle in view; handwritten plate inside cyan box.",
        flush=True,
    )
    print(
        "R: select plate region | C: clear OCR | Q/ESC: quit. No API writes or image recording.",
        flush=True,
    )
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window, 1000, 750)
    try:
        while True:
            ok, frame = capture.read()
            if not ok or frame is None:
                print(json.dumps({"status": "CAMERA_LOST", "plate": None}), flush=True)
                break
            now = time.monotonic()
            height, width = frame.shape[:2]
            if box is None:
                box = (width * 0.15, height * 0.35, width * 0.85, height * 0.72)
            detections = detector.detect(frame)
            if pending is not None and pending.done():
                try:
                    value = pending.result()
                    if phase == "loading":
                        engine = value
                        ocr_text = "Place handwritten plate inside cyan box"
                    elif result_box == box:
                        reading, sharp = value
                        last_ocr_at = now
                        if reading is None:
                            consensus.reset()
                            ocr_status, ocr_text = (
                                "UNREADABLE",
                                "BLURRY - hold steady / adjust focus",
                            )
                            print(
                                json.dumps(
                                    {
                                        "type": "OCR_EXPERIMENT",
                                        "status": "UNREADABLE",
                                        "reason": "blurry",
                                        "raw": None,
                                    }
                                ),
                                flush=True,
                            )
                        else:
                            stable, count = consensus.update("manual", reading, now)
                            if stable:
                                ocr_status = "READ"
                            elif reading.raw and not plausible_plate(
                                reading.normalized
                            ):
                                ocr_status = "TEXT_ONLY"
                            elif reading.raw:
                                ocr_status = "PENDING"
                            else:
                                ocr_status = "UNREADABLE"
                            ocr_text = f"{reading.normalized or '(no text)'} | conf={reading.confidence:.2f} samples={count}"
                            print(
                                json.dumps(
                                    {
                                        "type": "OCR_EXPERIMENT",
                                        "status": ocr_status,
                                        **asdict(reading),
                                        "samples": count,
                                    },
                                    ensure_ascii=False,
                                ),
                                flush=True,
                            )
                except Exception as error:
                    ocr_status, ocr_text = "ERROR", "OCR error - see terminal"
                    print(f"OCR error: {error}", flush=True)
                    if phase == "loading":
                        engine = None
                pending = None
            if engine is not None and pending is None and now - last_started >= 1.0:
                phase = "reading"
                result_box = box
                pending = pool.submit(read_crop, engine, frame.copy(), box)
                last_started = now
            if last_ocr_at and now - last_ocr_at > 5:
                shown_text = "OCR result stale - waiting for a fresh frame"
                shown_status = "WAITING"
            else:
                shown_text = ocr_text
                shown_status = ocr_status
            display = frame.copy()
            for detection in detections:
                x1, y1, x2, y2 = (int(value) for value in detection.bbox)
                cv2.rectangle(display, (x1, y1), (x2, y2), (40, 220, 70), 2)
                cv2.putText(
                    display,
                    f"{detection.class_name} {detection.confidence:.2f}",
                    (x1, max(20, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (40, 220, 70),
                    2,
                )
            x1, y1, x2, y2 = (int(value) for value in box)
            cv2.rectangle(display, (x1, y1), (x2, y2), (255, 240, 30), 2)
            cv2.rectangle(display, (0, 0), (width, 102), (20, 20, 20), -1)
            lines = [
                f"VEHICLES DETECTED: {len(detections)} | Q: quit | R: select plate box",
                "OCR: MANUAL REGION EXPERIMENT (independent of vehicle detection)",
                f"{shown_status}: {shown_text[:85]}",
            ]
            for index, line in enumerate(lines):
                cv2.putText(
                    display,
                    line,
                    (10, 25 + index * 29),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.46,
                    (245, 245, 245),
                    1,
                )
            cv2.imshow(window, display)
            if now - last_log >= 3:
                print(
                    json.dumps(
                        {
                            "type": "VEHICLE_EXPERIMENT",
                            "count": len(detections),
                            "detections": [
                                {
                                    "class": item.class_name,
                                    "confidence": round(item.confidence, 3),
                                }
                                for item in detections
                            ],
                        }
                    ),
                    flush=True,
                )
                last_log = now
            key = cv2.waitKey(1) & 0xFF
            if (
                key in (27, ord("q"))
                or cv2.getWindowProperty(window, cv2.WND_PROP_VISIBLE) < 1
            ):
                break
            if key == ord("r"):
                x, y, w, h = cv2.selectROI(
                    "Select handwritten plate - ENTER confirm / ESC cancel",
                    frame,
                    False,
                    False,
                )
                cv2.destroyWindow(
                    "Select handwritten plate - ENTER confirm / ESC cancel"
                )
                if w > 0 and h > 0:
                    box = (float(x), float(y), float(x + w), float(y + h))
                    consensus.reset()
                    last_ocr_at = 0
                    ocr_status, ocr_text = "UNREADABLE", "New manual region selected"
            if key == ord("c"):
                consensus.reset()
                last_ocr_at = 0
                ocr_status, ocr_text = "UNREADABLE", "Cleared - hold plate steady"
            if args.seconds and now - start >= args.seconds:
                break
    finally:
        capture.release()
        cv2.destroyAllWindows()
        pool.shutdown(wait=True, cancel_futures=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
