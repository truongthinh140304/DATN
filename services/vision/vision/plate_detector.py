"""A plate detector is separate from the COCO vehicle detector."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .domain import BoundingBox


@dataclass(frozen=True)
class PlateRegion:
    bbox: BoundingBox
    confidence: float | None
    source: str


class PlateDetector:
    def __init__(self, config: dict, base: Path):
        self.mode = config.get("mode", "manual")
        self.regions = config.get("manualRegions", [])
        self.threshold = float(config.get("confidence", 0.4))
        self.class_ids = config.get("classIds", [0])
        self.device = config.get("device", "cpu")
        self.model = None
        if self.mode == "model":
            path = Path(config.get("modelPath") or "")
            path = path if path.is_absolute() else base / path
            if not path.is_file():
                raise ValueError(
                    "Supply a real, separately trained plate modelPath; no plate weights are bundled"
                )
            from ultralytics import YOLO

            self.model = YOLO(str(path))
            labels = {str(self.model.names[i]).lower() for i in self.class_ids}
            if labels & {"car", "motorcycle", "bus", "truck", "person"}:
                raise ValueError(
                    "Configured classes belong to a vehicle/COCO model, not a plate detector"
                )
        elif self.mode != "manual":
            raise ValueError("Plate detector mode must be manual or model")
        for box in self.regions:
            if (
                len(box) != 4
                or not all(0 <= value <= 1 for value in box)
                or box[2] <= box[0]
                or box[3] <= box[1]
            ):
                raise ValueError("manualRegions must be normalized [x1,y1,x2,y2] boxes")

    def detect(self, frame: Any) -> list[PlateRegion]:
        if self.mode == "manual":
            height, width = frame.shape[:2]
            return [
                PlateRegion(
                    (x1 * width, y1 * height, x2 * width, y2 * height),
                    None,
                    "MANUAL_EXPERIMENT",
                )
                for x1, y1, x2, y2 in self.regions
            ]
        results = self.model.predict(
            frame,
            conf=self.threshold,
            classes=self.class_ids,
            device=self.device,
            verbose=False,
        )
        return [
            PlateRegion(
                tuple(float(x) for x in box.xyxy[0].tolist()),
                float(box.conf[0].item()),
                "MODEL",
            )
            for result in results
            for box in result.boxes
        ]
