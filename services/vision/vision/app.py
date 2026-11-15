from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone

from .config import load_rois, load_settings, to_pixel_rois
from .detector import DetectorSettings, YoloVehicleDetector
from .domain import FrameOccupancy
from .drawing import draw_overlay, draw_recognition_panel
from .occupancy import OccupancyRules, TemporalOccupancyFilter, evaluate_frame
from .reporter import VisionApiReporter
from .source import SourceOpenError, open_video_source


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Smart Parking weeks 6-8: vehicle occupancy, plate OCR and REST reporting"
    )
    parser.add_argument(
        "--settings",
        default="config/vision.json",
        help="Path to vision JSON settings",
    )
    parser.add_argument(
        "--no-api", action="store_true", help="Do not send observations to Express"
    )
    parser.add_argument(
        "--headless", action="store_true", help="Run without an OpenCV window"
    )
    parser.add_argument(
        "--max-frames", type=int, default=0, help="Stop after N frames (0 = no limit)"
    )
    return parser


def status_signature(observations: dict[str, FrameOccupancy]) -> tuple[str, ...]:
    return tuple(
        f"{spot_id}:{item.status.value}" for spot_id, item in observations.items()
    )


def main() -> int:
    args = build_parser().parse_args()
    settings = load_settings(args.settings)
    roi_camera_id, normalized_rois = load_rois(settings.roi_config)
    if roi_camera_id != settings.camera_id:
        raise ValueError(
            f"cameraId mismatch: settings={settings.camera_id}, ROI={roi_camera_id}"
        )

    detector = YoloVehicleDetector(
        DetectorSettings(
            model=settings.model,
            device=settings.device,
            confidence=settings.detector_confidence,
            image_size=settings.image_size,
        )
    )
    temporal_filter = TemporalOccupancyFilter(normalized_rois)
    plate_pipeline = None
    if settings.plate_config:
        from .plate_pipeline import PlatePipeline

        plate_pipeline = PlatePipeline(settings.plate_config)
    api_key = os.getenv("VISION_API_KEY", settings.api_key)
    reporter = None
    if not args.no_api and api_key:
        reporter = VisionApiReporter(settings.api_url, api_key)
    elif not args.no_api:
        print("VISION_API_KEY is empty; observations will not be sent to backend.")

    import cv2

    paused = False
    frame_count = 0
    fps = 0.0
    previous_time = time.perf_counter()
    last_report_time = 0.0
    last_report_attempt = 0.0
    last_signature: tuple[str, ...] | None = None
    last_observations: dict[str, FrameOccupancy] = {}

    capture = open_video_source(
        settings.source,
        backend=settings.video_backend,
        camera_name=settings.camera_name,
    )
    print(
        json.dumps(
            {
                "type": "VISION_STARTED",
                "cameraId": settings.camera_id,
                "cameraName": settings.camera_name,
                "source": settings.source,
                "backend": capture.getBackendName(),
                "spots": [
                    {"spotId": roi.spot_id, "code": roi.code} for roi in normalized_rois
                ],
                "reportingEnabled": reporter is not None,
            }
        ),
        flush=True,
    )
    try:
        while True:
            if paused and not args.headless:
                key = cv2.waitKey(30) & 0xFF
                if key in (ord("q"), 27):
                    break
                if key == ord(" "):
                    paused = False
                continue

            ok, frame = capture.read()
            observed_at = datetime.now(timezone.utc)
            if not ok or frame is None:
                last_observations = temporal_filter.camera_lost(observed_at)
                print(
                    json.dumps(
                        {
                            "cameraId": settings.camera_id,
                            "status": "UNKNOWN",
                            "recognitionStatus": "CAMERA_LOST",
                            "reason": "camera_signal_lost_or_video_ended",
                            "timestamp": observed_at.isoformat(),
                        }
                    )
                )
                if reporter:
                    reporter.send(
                        settings.camera_id,
                        last_observations,
                        {"reason": "camera_signal_lost_or_video_ended"},
                        plate_pipeline.camera_lost(last_observations)
                        if plate_pipeline
                        else None,
                    )
                break

            frame_count += 1
            height, width = frame.shape[:2]
            if frame_count == 1 and not args.headless:
                # AUTOSIZE can extend beyond the desktop at 1080p/high DPI.
                # Only resize the window; detection/OCR keep the original frame.
                preview_scale = min(1100 / width, 650 / height, 1.0)
                cv2.namedWindow("Smart Parking Vision - Weeks 6-8", cv2.WINDOW_NORMAL)
                cv2.resizeWindow(
                    "Smart Parking Vision - Weeks 6-8",
                    round(width * preview_scale),
                    round(height * preview_scale),
                )
                cv2.moveWindow("Smart Parking Vision - Weeks 6-8", 20, 30)
            pixel_rois = to_pixel_rois(normalized_rois, width, height)
            detections = detector.detect(frame)
            frame_results = evaluate_frame(
                pixel_rois,
                detections,
                OccupancyRules(),
                observed_at,
            )
            last_observations = temporal_filter.update(frame_results)

            recognitions = (
                plate_pipeline.process(
                    frame, pixel_rois, detections, last_observations, time.monotonic()
                )
                if plate_pipeline
                else None
            )

            current_time = time.perf_counter()
            frame_fps = 1.0 / max(current_time - previous_time, 1e-6)
            fps = frame_fps if fps == 0 else fps * 0.9 + frame_fps * 0.1
            previous_time = current_time

            signature = status_signature(last_observations) + tuple(
                f"{key}:{value['recognitionStatus']}:{value['plateNormalized'] if value['recognitionStatus'] == 'READ' else ''}"
                for key, value in (recognitions or {}).items()
            )
            report_due = (
                current_time - last_report_time >= settings.report_interval_seconds
            )
            if (
                reporter
                and (report_due or signature != last_signature)
                and current_time - last_report_attempt >= 2.0
            ):
                last_report_attempt = current_time
                try:
                    accepted = reporter.send(
                        settings.camera_id,
                        last_observations,
                        {
                            "detector": settings.model,
                            "device": settings.device,
                            "frameWidth": width,
                            "frameHeight": height,
                            "plateMode": plate_pipeline.detector.mode
                            if plate_pipeline
                            else "disabled",
                        },
                        recognitions,
                    )
                    print(
                        json.dumps(
                            {
                                "type": "VISION_REPORTED",
                                "cameraId": settings.camera_id,
                                "accepted": accepted,
                                "observations": [
                                    {
                                        "code": item.code,
                                        "occupancyStatus": item.status.value,
                                        **((recognitions or {}).get(spot_id, {})),
                                    }
                                    for spot_id, item in last_observations.items()
                                ],
                            },
                            ensure_ascii=False,
                        ),
                        flush=True,
                    )
                    last_report_time = current_time
                    last_signature = signature
                except Exception as error:  # Keep local demo alive on API failure.
                    print(f"Vision API report failed: {error}")

            if not args.headless:
                display = draw_overlay(
                    frame.copy(),
                    pixel_rois,
                    detections,
                    last_observations,
                    fps,
                )
                if recognitions:
                    draw_recognition_panel(display, last_observations, recognitions)
                cv2.imshow("Smart Parking Vision - Weeks 6-8", display)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), 27):
                    break
                if key == ord(" "):
                    paused = True
                if (
                    key == ord("r")
                    and plate_pipeline
                    and plate_pipeline.detector.mode == "manual"
                ):
                    title = "Select CURRENT vehicle plate - ENTER confirm, ESC cancel"
                    cv2.namedWindow(title, cv2.WINDOW_NORMAL)
                    cv2.resizeWindow(title, 1100, 750)
                    x, y, w, h = cv2.selectROI(title, frame, False, False)
                    cv2.destroyWindow(title)
                    if w > 0 and h > 0:
                        region = [
                            x / width,
                            y / height,
                            (x + w) / width,
                            (y + h) / height,
                        ]
                        config = json.loads(
                            settings.plate_config.read_text(encoding="utf-8")
                        )
                        config["detector"]["manualRegions"] = [region]
                        settings.plate_config.write_text(
                            json.dumps(config, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8",
                        )
                        plate_pipeline.detector.regions = [region]
                        plate_pipeline.consensus.reset()
                        plate_pipeline.previous_boxes.clear()
                        print(
                            "Manual plate region updated for the current vehicle. ROI assignments still require independent vehicle evidence.",
                            flush=True,
                        )

            if args.max_frames and frame_count >= args.max_frames:
                break
    finally:
        capture.release()
        if not args.headless:
            cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, ValueError, SourceOpenError, RuntimeError) as error:
        print(f"Vision service error: {error}")
        raise SystemExit(1) from error
