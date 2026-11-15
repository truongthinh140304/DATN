"""Controlled detections/OCR -> real geometry/consensus/reporter -> real test API.

This is a software integration fixture, never a camera accuracy measurement.
It refuses to post observations to slots outside its UUID-named test lot.
"""

import argparse
import json
import os
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import numpy as np
import requests

from vision.config import to_pixel_rois
from vision.domain import Detection
from vision.layout import grid_rois
from vision.occupancy import TemporalOccupancyFilter, evaluate_frame
from vision.plate_detector import PlateRegion
from vision.plate_ocr import PlateReading
from vision.plate_pipeline import PlatePipeline
from vision.plate_temporal import PlateConsensus
from vision.plate_text import normalize_plate
from vision.reporter import VisionApiReporter


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--plate", required=True)
    parser.add_argument("--spot-code", default="A01")
    parser.add_argument(
        "--scenario",
        choices=["read", "weak", "empty", "lost", "ambiguous"],
        default="read",
    )
    args = parser.parse_args()
    if not args.api_url.startswith(("http://127.0.0.1:", "http://localhost:")):
        raise ValueError("Controlled test bridge only posts to a local test server")
    key = os.environ["VISION_API_KEY"]
    mapping = json.loads(args.mapping)
    response = requests.get(
        args.api_url + "/api/vision/spots",
        headers={"x-vision-api-key": key},
        timeout=10,
    )
    response.raise_for_status()
    expected_lot = f"Week10 fixture {args.run_id}"
    known = {
        item["id"]
        for item in response.json()["items"]
        if item["area"]["lot"]["name"] == expected_lot
    }
    if not mapping or any(item["id"] not in known for item in mapping):
        raise ValueError(
            "Refusing controlled observations outside the current test fixture lot"
        )
    rois = to_pixel_rois(grid_rois(mapping, len(mapping)), 1280, 480)
    roi = next(item for item in rois if item.code == args.spot_code)
    x1, y1 = roi.polygon[0]
    x2, y2 = roi.polygon[2]
    car = Detection((x1 + 5, y1 + 20, x2 - 5, y2 - 5), 0.95, "car")
    plate = PlateRegion(
        (x1 + 30, y2 - 65, x2 - 30, y2 - 30), None, "CONTROLLED_TEST_FIXTURE"
    )
    vehicles = [] if args.scenario == "empty" else [car]
    if args.scenario == "ambiguous":
        # Two overlapping vehicle detections make plate-to-vehicle assignment uncertain.
        vehicles.append(Detection(car.bbox, 0.94, "car"))
    pipeline = object.__new__(PlatePipeline)
    pipeline.detector = SimpleNamespace(detect=lambda _frame: [plate])
    pipeline.consensus = PlateConsensus(ttl=10)
    pipeline.previous_boxes = {}
    confidence = 0.4 if args.scenario == "weak" else 0.95
    pipeline.read_region = lambda _frame, _region: (
        PlateReading(args.plate, normalize_plate(args.plate), confidence),
        True,
    )
    temporal = TemporalOccupancyFilter(rois)
    frame = np.zeros((480, 1280, 3), dtype=np.uint8)
    for _ in range(5):
        observations = temporal.update(
            evaluate_frame(rois, vehicles, observed_at=datetime.now(timezone.utc))
        )
        readings = pipeline.process(
            frame, rois, vehicles, observations, time.monotonic()
        )
    if args.scenario == "lost":
        observations = temporal.camera_lost()
        readings = pipeline.camera_lost(observations)
    accepted = VisionApiReporter(args.api_url, key).send(
        f"week10-{args.run_id}",
        observations,
        {"evidenceSource": "CONTROLLED_TEST_FIXTURE", "testRunId": args.run_id},
        readings,
    )
    print(
        json.dumps(
            {
                "evidenceSource": "CONTROLLED_TEST_FIXTURE",
                "accepted": accepted,
                "spots": [
                    {
                        "code": value.code,
                        "occupancy": value.status.value,
                        **readings[spot_id],
                    }
                    for spot_id, value in observations.items()
                ],
            }
        )
    )


if __name__ == "__main__":
    main()
