from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .config import parse_source, save_rois
from .domain import ParkingRoi
from .source import open_video_source


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Draw normalized parking polygons on a camera/video frame"
    )
    parser.add_argument("--source", default="0", help="Webcam index, MP4 or RTSP")
    parser.add_argument("--spots", required=True, help="JSON with cameraId and 5 spots")
    parser.add_argument("--output", required=True, help="Output ROI JSON")
    return parser


def load_spot_mapping(path: str | Path) -> tuple[str, list[dict[str, str]]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    spots = payload["spots"]
    if len(spots) != 5:
        raise ValueError("Week 6 ROI tool requires exactly 5 spots")
    return str(payload["cameraId"]), spots


def main() -> int:
    args = build_parser().parse_args()
    camera_id, spots = load_spot_mapping(args.spots)
    capture = open_video_source(parse_source(args.source))
    ok, frame = capture.read()
    capture.release()
    if not ok or frame is None:
        raise RuntimeError("Cannot read the first frame from video source")

    import cv2
    import numpy as np

    height, width = frame.shape[:2]
    completed: list[list[tuple[int, int]]] = []
    current: list[tuple[int, int]] = []
    window_name = "Smart Parking ROI Tool"

    def mouse_callback(event: int, x: int, y: int, _flags: int, _data: Any) -> None:
        if event == cv2.EVENT_LBUTTONDOWN:
            current.append((x, y))
        elif event == cv2.EVENT_RBUTTONDOWN and current:
            current.pop()

    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(window_name, mouse_callback)

    while len(completed) < len(spots):
        canvas = frame.copy()
        for index, polygon in enumerate(completed):
            points = np.array(polygon, dtype=np.int32)
            cv2.polylines(canvas, [points], True, (70, 180, 90), 2)
            cv2.putText(
                canvas,
                spots[index]["code"],
                polygon[0],
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (70, 180, 90),
                2,
                cv2.LINE_AA,
            )
        if current:
            points = np.array(current, dtype=np.int32)
            cv2.polylines(canvas, [points], False, (70, 190, 230), 2)
            for point in current:
                cv2.circle(canvas, point, 4, (70, 190, 230), -1)

        current_code = spots[len(completed)]["code"]
        cv2.rectangle(canvas, (8, 8), (620, 72), (20, 30, 38), -1)
        cv2.putText(
            canvas,
            f"Draw {current_code}: left click points, right click undo, ENTER confirm",
            (18, 34),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            (245, 245, 245),
            1,
            cv2.LINE_AA,
        )
        cv2.putText(
            canvas,
            "R reset current | Q/ESC cancel",
            (18, 58),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (205, 220, 218),
            1,
            cv2.LINE_AA,
        )
        cv2.imshow(window_name, canvas)
        key = cv2.waitKey(20) & 0xFF
        if key in (ord("q"), 27):
            cv2.destroyAllWindows()
            return 1
        if key == ord("r"):
            current.clear()
        if key in (10, 13) and len(current) >= 3:
            completed.append(list(current))
            current.clear()

    cv2.destroyAllWindows()
    rois = [
        ParkingRoi(
            spot_id=str(spot["spotId"]),
            code=str(spot["code"]),
            polygon=tuple((x / width, y / height) for x, y in polygon),
        )
        for spot, polygon in zip(spots, completed, strict=True)
    ]
    save_rois(args.output, camera_id, rois, width, height)
    print(f"Saved 5 normalized polygons to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
