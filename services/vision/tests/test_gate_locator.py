import tempfile
import unittest
from pathlib import Path

import numpy as np

from vision.domain import Detection
from vision.plate_detector import GatePlateLocator


class GateLocatorTests(unittest.TestCase):
    def test_scan_zone_works_without_vehicle_box(self) -> None:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        locator = GatePlateLocator(
            mode="scan_zone",
            scan_region=(0.25, 0.25, 0.75, 0.75),
            prefer_vehicle_crop=False,
        )
        regions = locator.locate(frame, vehicles=[])
        self.assertEqual(len(regions), 1)
        self.assertEqual(regions[0].source, "SCAN_ZONE")
        self.assertEqual(regions[0].bbox, (160.0, 120.0, 480.0, 360.0))

    def test_prefer_vehicle_crop_uses_intersecting_vehicle(self) -> None:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        locator = GatePlateLocator(
            mode="scan_zone",
            scan_region=(0.25, 0.25, 0.75, 0.75),
            prefer_vehicle_crop=True,
        )
        car = Detection((180.0, 140.0, 400.0, 340.0), 0.91, "car")
        regions = locator.locate(frame, vehicles=[car])
        self.assertEqual(len(regions), 1)
        self.assertEqual(regions[0].source, "VEHICLE_CROP")
        self.assertEqual(regions[0].bbox, car.bbox)

    def test_full_frame_and_missing_model_validation(self) -> None:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        full = GatePlateLocator(mode="full_frame")
        regions = full.locate(frame)
        self.assertEqual(regions[0].bbox, (0.0, 0.0, 640.0, 480.0))
        self.assertEqual(regions[0].source, "FULL_FRAME")

        with (
            tempfile.TemporaryDirectory() as directory,
            self.assertRaises(ValueError),
        ):
            GatePlateLocator(mode="model", model_path=Path(directory) / "missing.pt")


if __name__ == "__main__":
    unittest.main()
