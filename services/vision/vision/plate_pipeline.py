import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from .domain import Detection, OccupancyStatus, ParkingRoi
from .occupancy import OccupancyRules, assign_detections
from .plate_detector import PlateDetector, PlateRegion
from .plate_ocr import PaddlePlateOcr, PlateReading
from .plate_preprocess import PreprocessSettings, crop_original, preprocess
from .plate_temporal import PlateConsensus


def contained_fraction(inner: tuple, outer: tuple) -> float:
    x1, y1, x2, y2 = inner
    a, b, c, d = outer
    area = max(0, x2 - x1) * max(0, y2 - y1)
    return (
        max(0, min(x2, c) - max(x1, a)) * max(0, min(y2, d) - max(y1, b)) / area
        if area
        else 0.0
    )


def associate_regions(
    rois: list[ParkingRoi], vehicles: list[Detection], plates: list[PlateRegion]
) -> tuple[dict, set[str], dict]:
    assignments, uncertain = assign_detections(rois, vehicles, OccupancyRules())
    vehicles_by_spot: dict = defaultdict(list)
    for assignment in assignments:
        vehicles_by_spot[assignment.roi.spot_id].append(assignment)
    linked: dict = defaultdict(list)
    for plate in plates:
        # Every containing vehicle participates, including vehicles whose ROI is
        # ambiguous. Never use plate position alone to infer a vehicle/spot.
        candidates = [
            vehicle
            for vehicle in vehicles
            if contained_fraction(plate.bbox, vehicle.bbox) >= 0.9
        ]
        if len(candidates) != 1:
            for assignment in assignments:
                if assignment.detection in candidates:
                    uncertain.add(assignment.roi.spot_id)
            continue
        for assignment in assignments:
            if assignment.detection is candidates[0]:
                linked[assignment.roi.spot_id].append((plate, assignment))
    for spot_id, items in vehicles_by_spot.items():
        if len(items) != 1 or len(linked.get(spot_id, [])) > 1:
            uncertain.add(spot_id)
    return dict(linked), uncertain, dict(vehicles_by_spot)


def empty_recognition(status: str) -> dict:
    return {
        "recognitionStatus": status,
        "plateRaw": None,
        "plateNormalized": None,
        "ocrConfidence": None,
        "vehicleConfidence": None,
        "plateDetectionConfidence": None,
        "associationConfidence": None,
        "plateSamples": 0,
    }


class PlatePipeline:
    def __init__(self, path: str | Path, config: dict | None = None):
        path = Path(path).resolve()
        config = (
            config
            if config is not None
            else json.loads(path.read_text(encoding="utf-8"))
        )
        self.detector = PlateDetector(config.get("detector", {}), path.parent)
        if self.detector.mode == "manual" and not self.detector.regions:
            raise ValueError(
                "Select manual plate regions with plate_cli --select --save-regions, or configure a real plate model"
            )
        self.preprocessing = PreprocessSettings(**config.get("preprocess", {}))
        self.consensus = PlateConsensus(**config.get("consensus", {}))
        self.ocr = PaddlePlateOcr(config.get("ocr", {}))
        self.previous_boxes: dict = {}

    def read_region(self, frame: Any, region: PlateRegion) -> tuple[PlateReading, bool]:
        image, sharp = preprocess(crop_original(frame, region.bbox), self.preprocessing)
        if not sharp:
            return PlateReading(), False
        return self.ocr.read(image), True

    def camera_lost(self, spot_ids: Any) -> dict:
        self.consensus.reset()
        self.previous_boxes.clear()
        return {key: empty_recognition("CAMERA_LOST") for key in spot_ids}

    def process(
        self,
        frame: Any,
        rois: list[ParkingRoi],
        vehicles: list[Detection],
        observations: dict,
        now: float,
    ) -> dict:
        regions = self.detector.detect(frame)
        linked, uncertain, by_spot = associate_regions(rois, vehicles, regions)
        output = {}
        for roi in rois:
            key = roi.spot_id
            observation = observations[key]
            if key in uncertain or observation.status is OccupancyStatus.UNKNOWN:
                status = "AMBIGUOUS"
            elif observation.status is OccupancyStatus.EMPTY and not by_spot.get(key):
                status = "NO_VEHICLE"
            else:
                status = "UNREADABLE"
            result = empty_recognition(status)
            current_vehicles = by_spot.get(key, [])
            if status == "UNREADABLE" and len(current_vehicles) == 1:
                result.update(
                    {
                        "vehicleConfidence": current_vehicles[0].detection.confidence,
                        "associationConfidence": current_vehicles[0].evidence,
                    }
                )
            pairs = linked.get(key, [])
            if (
                status != "UNREADABLE"
                or len(pairs) != 1
                or observation.status is not OccupancyStatus.OCCUPIED
            ):
                self.consensus.reset(key)
                self.previous_boxes.pop(key, None)
                output[key] = result
                continue
            plate, assignment = pairs[0]
            previous = self.previous_boxes.get(key)
            box = assignment.detection.bbox
            if (
                previous is not None
                and min(
                    contained_fraction(box, previous), contained_fraction(previous, box)
                )
                < 0.6
            ):
                self.consensus.reset(key)
            self.previous_boxes[key] = box
            reading, _sharp = self.read_region(frame, plate)
            stable, count = self.consensus.update(key, reading, now)
            result.update(
                {
                    "plateRaw": reading.raw or None,
                    "plateNormalized": reading.normalized or None,
                    "ocrConfidence": reading.confidence if reading.raw else None,
                    "vehicleConfidence": assignment.detection.confidence,
                    "associationConfidence": assignment.evidence,
                    "plateDetectionConfidence": plate.confidence,
                    "plateSamples": count,
                    "recognitionStatus": "READ" if stable else "UNREADABLE",
                }
            )
            if stable:
                result.update(
                    {
                        "plateRaw": stable.raw,
                        "plateNormalized": stable.normalized,
                        "ocrConfidence": stable.confidence,
                    }
                )
            # Blur is represented by UNREADABLE, without cached plate text.
            output[key] = result
        return output
