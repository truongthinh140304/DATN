from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .domain import ParkingRoi


@dataclass(frozen=True)
class VisionSettings:
    camera_id: str
    source: str | int
    roi_config: Path
    model: str = "yolo11n.pt"
    device: str = "cpu"
    image_size: int = 640
    detector_confidence: float = 0.15
    report_interval_seconds: float = 2.0
    api_url: str = "http://localhost:4000"
    api_key: str = ""


def parse_source(value: str | int) -> str | int:
    if isinstance(value, int):
        return value
    stripped = value.strip()
    return int(stripped) if stripped.isdigit() else stripped


def load_settings(path: str | Path) -> VisionSettings:
    config_path = Path(path).resolve()
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    roi_path = Path(payload["roiConfig"])
    if not roi_path.is_absolute():
        roi_path = (config_path.parent / roi_path).resolve()
    return VisionSettings(
        camera_id=str(payload["cameraId"]),
        source=parse_source(payload.get("source", 0)),
        roi_config=roi_path,
        model=str(payload.get("model", "yolo11n.pt")),
        device=str(payload.get("device", "cpu")),
        image_size=int(payload.get("imageSize", 640)),
        detector_confidence=float(payload.get("detectorConfidence", 0.15)),
        report_interval_seconds=float(payload.get("reportIntervalSeconds", 2.0)),
        api_url=str(payload.get("apiUrl", "http://localhost:4000")),
        api_key=str(payload.get("apiKey", "")),
    )


def load_rois(path: str | Path) -> tuple[str, list[ParkingRoi]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    camera_id = str(payload["cameraId"])
    rois: list[ParkingRoi] = []
    seen_codes: set[str] = set()
    seen_ids: set[str] = set()
    for item in payload["spots"]:
        code = str(item["code"]).strip().upper()
        spot_id = str(item["spotId"]).strip()
        polygon = tuple((float(x), float(y)) for x, y in item["polygon"])
        if len(polygon) < 3:
            raise ValueError(f"ROI {code} must contain at least 3 points")
        if any(not (0 <= x <= 1 and 0 <= y <= 1) for x, y in polygon):
            raise ValueError(f"ROI {code} must use normalized coordinates 0..1")
        if code in seen_codes or spot_id in seen_ids:
            raise ValueError(f"Duplicate ROI mapping for {code}")
        seen_codes.add(code)
        seen_ids.add(spot_id)
        rois.append(ParkingRoi(spot_id=spot_id, code=code, polygon=polygon))
    return camera_id, rois


def save_rois(
    path: str | Path,
    camera_id: str,
    rois: list[ParkingRoi],
    frame_width: int,
    frame_height: int,
) -> None:
    payload: dict[str, Any] = {
        "version": 1,
        "cameraId": camera_id,
        "coordinateSystem": "normalized",
        "referenceFrame": {"width": frame_width, "height": frame_height},
        "spots": [
            {
                "spotId": roi.spot_id,
                "code": roi.code,
                "polygon": [[round(x, 6), round(y, 6)] for x, y in roi.polygon],
            }
            for roi in rois
        ],
    }
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def to_pixel_rois(
    rois: list[ParkingRoi], width: int, height: int
) -> list[ParkingRoi]:
    return [
        ParkingRoi(
            spot_id=roi.spot_id,
            code=roi.code,
            polygon=tuple((x * width, y * height) for x, y in roi.polygon),
        )
        for roi in rois
    ]
