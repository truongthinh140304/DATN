"""Gate plate locator supporting scan-zone, full-frame, and custom YOLO plate model."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .domain import BoundingBox, Detection


@dataclass(frozen=True)
class PlateRegion:
    bbox: BoundingBox
    confidence: float | None
    source: str


def _intersects(a: BoundingBox, b: BoundingBox) -> bool:
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


class GatePlateLocator:
    def __init__(
        self,
        *,
        mode: str = "scan_zone",
        scan_region: tuple[float, float, float, float] = (0.15, 0.25, 0.85, 0.80),
        prefer_vehicle_crop: bool = False,
        model_path: Path | None = None,
        class_ids: tuple[int, ...] = (0,),
        confidence: float = 0.4,
        device: str = "cpu",
    ) -> None:
        if mode not in {"scan_zone", "model", "full_frame"}:
            raise ValueError("Plate locator mode must be scan_zone, model or full_frame")
        self.mode = mode
        self.scan_region = scan_region
        self.prefer_vehicle_crop = prefer_vehicle_crop
        self.threshold = float(confidence)
        self.class_ids = list(class_ids)
        self.device = device
        self.model = None

        if self.mode == "model":
            if not model_path or not Path(model_path).is_file():
                raise ValueError(
                    "Supply a valid plateModelPath when plateMode is 'model'"
                )
            from ultralytics import YOLO

            self.model = YOLO(str(model_path))
            labels = {str(self.model.names[i]).lower() for i in self.class_ids}
            if labels & {"car", "motorcycle", "bus", "truck", "person"}:
                raise ValueError(
                    "Configured classes belong to a vehicle/COCO model, not a plate detector"
                )

    def locate(
        self, frame: Any, vehicles: list[Detection] | None = None
    ) -> list[PlateRegion]:
        height, width = frame.shape[:2]

        if self.mode == "full_frame":
            return [PlateRegion((0.0, 0.0, float(width), float(height)), None, "FULL_FRAME")]

        if self.mode == "model":
            assert self.model is not None
            results = self.model.predict(
                frame,
                conf=self.threshold,
                classes=self.class_ids,
                device=self.device,
                verbose=False,
            )
            return [
                PlateRegion(
                    tuple(float(v) for v in box.xyxy[0].tolist()),  # type: ignore[arg-type]
                    float(box.conf[0].item()),
                    "MODEL",
                )
                for result in results
                for box in result.boxes
            ]

        # scan_zone mode: works out-of-the-box for both printed plates / toy cars
        # (where COCO YOLO may not detect a vehicle) and full-size cars.
        x1, y1, x2, y2 = self.scan_region
        zone_box: BoundingBox = (x1 * width, y1 * height, x2 * width, y2 * height)

        if self.prefer_vehicle_crop and vehicles:
            inside = [
                vehicle for vehicle in vehicles if _intersects(vehicle.bbox, zone_box)
            ]
            if inside:
                best = max(inside, key=lambda item: item.confidence)
                return [PlateRegion(best.bbox, best.confidence, "VEHICLE_CROP")]

        return [PlateRegion(zone_box, None, "SCAN_ZONE")]
