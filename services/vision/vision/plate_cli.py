"""Independent OCR experiment: no vehicle detection, no inferred occupancy, no API writes."""

import argparse
import json
import time
from dataclasses import asdict
from pathlib import Path

from .config import parse_source
from .plate_pipeline import PlatePipeline
from .source import open_video_source


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image")
    source.add_argument("--source", help="Webcam index, video or RTSP")
    parser.add_argument(
        "--select", action="store_true", help="Select experimental manual plate regions"
    )
    parser.add_argument(
        "--save-regions",
        action="store_true",
        help="Save selected normalized regions into --config",
    )
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--max-frames", type=int, default=0)
    args = parser.parse_args()
    if args.select and args.headless:
        parser.error("--select requires an interactive OpenCV window")
    if args.save_regions and not args.select:
        parser.error("--save-regions requires --select")
    import cv2

    capture = None
    try:
        if args.image:
            frame = cv2.imread(args.image)
            if frame is None:
                raise ValueError("Cannot read image")
        else:
            capture = open_video_source(parse_source(args.source))
            ok, frame = capture.read()
            if not ok or frame is None:
                raise ValueError("Cannot read first frame")
        path = Path(args.config).resolve()
        config = json.loads(path.read_text(encoding="utf-8"))
        if args.select:
            boxes = cv2.selectROIs(
                "MANUAL OCR EXPERIMENT - Enter/Space confirm, Esc finish",
                frame,
                False,
                False,
            )
            cv2.destroyAllWindows()
            height, width = frame.shape[:2]
            regions = [
                [
                    float(x / width),
                    float(y / height),
                    float((x + w) / width),
                    float((y + h) / height),
                ]
                for x, y, w, h in boxes
                if w > 0 and h > 0
            ]
            if not regions:
                raise ValueError("No manual regions selected")
            config.setdefault("detector", {}).update(
                {"mode": "manual", "manualRegions": regions}
            )
            if args.save_regions:
                path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
            print(json.dumps({"manualRegions": regions, "experimental": True}))
        pipeline = PlatePipeline(path, config)
        # The in-memory selection also works without saving the config file.
        if args.select:
            pipeline.detector.mode = "manual"
            pipeline.detector.regions = regions
        if pipeline.detector.mode == "manual" and not pipeline.detector.regions:
            raise ValueError(
                "No plate model/region: use --select --save-regions for a manual OCR experiment"
            )
        frame_count = 0
        while True:
            regions_detected = pipeline.detector.detect(frame)
            readings = []
            for index, region in enumerate(regions_detected):
                reading, sharp = pipeline.read_region(frame, region)
                stable, count = pipeline.consensus.update(
                    str(index), reading, time.monotonic()
                )
                readings.append(
                    {
                        **asdict(reading),
                        "sharp": sharp,
                        "stable": stable is not None,
                        "samples": count,
                        "bbox": region.bbox,
                        "plateDetectionConfidence": region.confidence,
                    }
                )
            if not regions_detected:
                pipeline.consensus.reset()
            print(
                json.dumps(
                    {
                        "mode": "OCR_ONLY_EXPERIMENT",
                        "frame": frame_count,
                        "readings": readings,
                    },
                    ensure_ascii=False,
                )
            )
            frame_count += 1
            if args.image or (args.max_frames and frame_count >= args.max_frames):
                break
            if not args.headless:
                cv2.imshow("OCR experiment - no vehicle or occupancy assertion", frame)
                if cv2.waitKey(1) & 0xFF in (27, ord("q")):
                    break
            ok, frame = capture.read()
            if not ok or frame is None:
                print(
                    json.dumps({"status": "CAMERA_LOST_OR_VIDEO_ENDED", "readings": []})
                )
                break
    finally:
        if capture is not None:
            capture.release()
        cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
