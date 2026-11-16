"""Read-only hardware diagnostics for USB camera and Arduino Uno R3 COM ports."""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
from pathlib import Path

from .arduino_gate import list_serial_ports, select_arduino_port
from .config import load_gate_settings
from .source import open_video_source


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--settings", default="config/gate.json")
    parser.add_argument("--read-frame", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()

    ports = list_serial_ports()
    report: dict[str, object] = {
        "python": platform.python_version(),
        "keyConfigured": bool(os.environ.get("VISION_API_KEY")),
        "cameraCheck": "NOT_REQUESTED",
        "cameras": [],
        "serialPorts": [
            {
                "device": item.device,
                "description": item.description,
                "hwid": item.hwid,
            }
            for item in ports
        ],
        "selectedArduinoPort": select_arduino_port("auto", ports),
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

        settings = load_gate_settings(args.settings)
        private_source = settings.source if isinstance(settings.source, str) else None
        report["configuration"] = {
            "gateId": settings.gate_id,
            "lotId": settings.lot_id,
            "cameraName": settings.camera_name,
            "source": (
                settings.source
                if isinstance(settings.source, int)
                else "REDACTED_STREAM_OR_MEDIA_PATH"
            ),
            "backend": settings.video_backend,
            "plateMode": settings.plate_mode,
            "arduinoEnabled": settings.arduino.enabled,
            "arduinoPort": settings.arduino.port,
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
