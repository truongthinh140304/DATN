from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def parse_source(value: str | int) -> str | int:
    if isinstance(value, int):
        return value
    stripped = str(value).strip()
    return int(stripped) if stripped.isdigit() else stripped


@dataclass(frozen=True)
class ArduinoSettings:
    enabled: bool = True
    port: str = "auto"
    baudrate: int = 9600
    open_ms: int = 5000


@dataclass(frozen=True)
class GateSettings:
    gate_id: str
    lot_id: str | None = None
    source: str | int = 0
    video_backend: str = "dshow"
    camera_name: str | None = None
    yolo_enabled: bool = True
    yolo_model: str = "models/yolo11n.pt"
    yolo_confidence: float = 0.25
    device: str = "cpu"
    image_size: int = 640
    plate_mode: str = "scan_zone"
    plate_model_path: Path | None = None
    plate_confidence: float = 0.4
    plate_class_ids: tuple[int, ...] = (0,)
    scan_region: tuple[float, float, float, float] = (0.15, 0.25, 0.85, 0.80)
    prefer_vehicle_crop: bool = False
    ocr_interval_seconds: float = 0.35
    cooldown_seconds: float = 15.0
    api_url: str = "http://localhost:4000"
    api_key: str = ""
    preprocess: dict[str, Any] = field(default_factory=dict)
    ocr: dict[str, Any] = field(default_factory=dict)
    consensus: dict[str, Any] = field(default_factory=dict)
    arduino: ArduinoSettings = field(default_factory=ArduinoSettings)


def _validate_region(region: list[float] | tuple[float, ...]) -> tuple[float, float, float, float]:
    if (
        len(region) != 4
        or not all(0.0 <= float(value) <= 1.0 for value in region)
        or float(region[2]) <= float(region[0])
        or float(region[3]) <= float(region[1])
    ):
        raise ValueError("scanRegion must be normalized [x1, y1, x2, y2] in 0..1")
    return tuple(float(value) for value in region)  # type: ignore[return-value]


def load_gate_settings(path: str | Path) -> GateSettings:
    config_path = Path(path).resolve()
    payload = json.loads(config_path.read_text(encoding="utf-8"))

    backend = str(payload.get("videoBackend", "dshow"))
    if backend not in {"auto", "dshow", "msmf"}:
        raise ValueError("videoBackend must be auto, dshow or msmf")

    plate_mode = str(payload.get("plateMode", "scan_zone"))
    if plate_mode not in {"scan_zone", "model", "full_frame"}:
        raise ValueError("plateMode must be scan_zone, model or full_frame")

    plate_model_raw = payload.get("plateModelPath")
    plate_model_path = None
    if plate_model_raw:
        candidate = Path(str(plate_model_raw))
        plate_model_path = (
            candidate if candidate.is_absolute() else (config_path.parent / candidate).resolve()
        )

    arduino_raw = payload.get("arduino", {}) or {}
    arduino = ArduinoSettings(
        enabled=bool(arduino_raw.get("enabled", True)),
        port=str(arduino_raw.get("port", "auto")),
        baudrate=int(arduino_raw.get("baudrate", 9600)),
        open_ms=int(arduino_raw.get("openMs", 5000)),
    )

    yolo_model_raw = str(payload.get("yoloModel", "models/yolo11n.pt"))
    yolo_candidate = (config_path.parent.parent / yolo_model_raw).resolve()
    yolo_model = str(yolo_candidate) if yolo_candidate.is_file() else yolo_model_raw

    return GateSettings(
        gate_id=str(payload.get("gateId", "main-gate-01")),
        lot_id=str(payload["lotId"]).strip() if payload.get("lotId") else None,
        source=parse_source(payload.get("source", 0)),
        video_backend=backend,
        camera_name=payload.get("cameraName") or None,
        yolo_enabled=bool(payload.get("yoloEnabled", True)),
        yolo_model=yolo_model,
        yolo_confidence=float(payload.get("yoloConfidence", 0.25)),
        device=str(payload.get("device", "cpu")),
        image_size=int(payload.get("imageSize", 640)),
        plate_mode=plate_mode,
        plate_model_path=plate_model_path,
        plate_confidence=float(payload.get("plateConfidence", 0.4)),
        plate_class_ids=tuple(int(x) for x in payload.get("plateClassIds", [0])),
        scan_region=_validate_region(payload.get("scanRegion", [0.15, 0.25, 0.85, 0.80])),
        prefer_vehicle_crop=bool(payload.get("preferVehicleCrop", False)),
        ocr_interval_seconds=float(payload.get("ocrIntervalSeconds", 0.35)),
        cooldown_seconds=float(payload.get("cooldownSeconds", 15.0)),
        api_url=str(payload.get("apiUrl", "http://localhost:4000")),
        api_key=str(payload.get("apiKey", "")),
        preprocess=dict(payload.get("preprocess", {}) or {}),
        ocr=dict(payload.get("ocr", {}) or {}),
        consensus=dict(payload.get("consensus", {}) or {}),
        arduino=arduino,
    )


def save_scan_region(
    path: str | Path, region: tuple[float, float, float, float]
) -> None:
    config_path = Path(path).resolve()
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    payload["scanRegion"] = [round(value, 4) for value in _validate_region(region)]
    config_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
