"""Read-only diagnostics; a frame-read check is not an AI accuracy measurement."""

import argparse
import json
import os
import platform
import sys
from pathlib import Path

from .config import load_rois, load_settings
from .source import open_video_source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--settings", default="config/vision.json")
    parser.add_argument("--read-frame", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()
    report = {
        "python": platform.python_version(),
        "keyConfigured": bool(os.environ.get("VISION_API_KEY")),
        "physicalRecognitionVerified": False,
        "cameraCheck": "NOT_REQUESTED",
        "cameras": [],
    }
    private_source = None
    try:
        import cv2

        if sys.platform == "win32":
            from cv2_enumerate_cameras import enumerate_cameras

            report["cameras"] = [
                {"index": item.index, "name": item.name}
                for item in enumerate_cameras(cv2.CAP_DSHOW)
            ]
        settings = load_settings(args.settings)
        private_source = settings.source if isinstance(settings.source, str) else None
        camera_id, rois = load_rois(settings.roi_config)
        report["configuration"] = {
            "cameraId": camera_id,
            "cameraName": settings.camera_name,
            "source": settings.source
            if isinstance(settings.source, int)
            else "REDACTED_STREAM_OR_MEDIA_PATH",
            "backend": settings.video_backend,
            "spots": [item.code for item in rois],
            "ocrEnabled": settings.plate_config is not None,
        }
        if args.read_frame:
            capture = open_video_source(
                settings.source,
                backend=settings.video_backend,
                camera_name=settings.camera_name,
            )
            try:
                ok, frame = capture.read()
                report["cameraCheck"] = (
                    "FRAME_OK" if ok and frame is not None else "NO_FRAME"
                )
                if ok and frame is not None:
                    report["frameShape"] = list(frame.shape)
            finally:
                capture.release()
    except (ImportError, FileNotFoundError, ValueError, RuntimeError) as error:
        report["diagnostic"] = (
            str(error).replace(private_source, "[redacted source]")
            if private_source
            else str(error)
        )
        report["cameraCheck"] = "UNAVAILABLE" if args.read_frame else "NOT_REQUESTED"
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
