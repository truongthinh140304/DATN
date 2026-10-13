from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .domain import Detection


@dataclass(frozen=True)
class DetectorSettings:
    model: str = "yolo11n.pt"
    device: str = "cpu"
    confidence: float = 0.15
    image_size: int = 640
    vehicle_classes: tuple[int, ...] = (2, 3, 5, 7)


class YoloVehicleDetector:
    def __init__(self, settings: DetectorSettings) -> None:
        self.settings = settings
        try:
            from ultralytics import YOLO
        except ImportError as error:
            raise RuntimeError(
                "Ultralytics is not installed. Run: pip install -r requirements.txt"
            ) from error
        self.model = YOLO(settings.model)

    def detect(self, frame: Any) -> list[Detection]:
        results = self.model.predict(
            source=frame,
            conf=self.settings.confidence,
            imgsz=self.settings.image_size,
            device=self.settings.device,
            classes=list(self.settings.vehicle_classes),
            verbose=False,
        )
        detections: list[Detection] = []
        for result in results:
            names = result.names
            for box in result.boxes:
                coordinates = box.xyxy[0].tolist()
                class_id = int(box.cls[0].item())
                detections.append(
                    Detection(
                        bbox=tuple(float(value) for value in coordinates),
                        confidence=float(box.conf[0].item()),
                        class_name=str(names[class_id]),
                    )
                )
        return detections
