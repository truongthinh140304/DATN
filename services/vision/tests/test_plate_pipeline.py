import importlib.util
import unittest
from unittest.mock import Mock

from vision.domain import Detection, ParkingRoi
from vision.occupancy import evaluate_frame
from vision.plate_detector import PlateRegion
from vision.plate_ocr import PlateReading
from vision.plate_pipeline import PlatePipeline
from vision.plate_temporal import PlateConsensus


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.roi = ParkingRoi("a", "A01", ((0, 0), (100, 0), (100, 100), (0, 100)))
        self.car = Detection((10, 10, 90, 90), 0.9, "car")
        self.region = PlateRegion((30, 40, 60, 60), None, "MANUAL_EXPERIMENT")
        self.pipeline = object.__new__(PlatePipeline)
        self.pipeline.detector = Mock()
        self.pipeline.detector.detect.return_value = [self.region]
        self.pipeline.consensus = PlateConsensus()
        self.pipeline.previous_boxes = {}
        self.pipeline.read_region = Mock(
            return_value=(PlateReading("30A-12345", "30A12345", 0.95), True)
        )

    def process(self, vehicles, now):
        observations = evaluate_frame([self.roi], vehicles)
        return self.pipeline.process(None, [self.roi], vehicles, observations, now)["a"]

    def test_empty_unreadable_camera_lost_and_new_vehicle_are_distinct(self):
        self.assertEqual(self.process([], 0)["recognitionStatus"], "NO_VEHICLE")
        for index in range(3):
            result = self.process([self.car], index * 0.1)
        self.assertEqual(result["recognitionStatus"], "READ")
        self.assertIsNone(
            result["plateDetectionConfidence"]
        )  # Manual is not a detector probability.
        self.pipeline.read_region.return_value = (PlateReading(), False)
        blurred = self.process([self.car], 0.4)
        self.assertEqual(blurred["recognitionStatus"], "UNREADABLE")
        self.assertIsNone(blurred["plateRaw"])
        lost = self.pipeline.camera_lost(["a"])["a"]
        self.assertEqual(lost["recognitionStatus"], "CAMERA_LOST")
        self.assertIsNone(lost["plateNormalized"])
        self.pipeline.read_region.return_value = (
            PlateReading("30A-12345", "30A12345", 0.95),
            True,
        )
        self.assertEqual(
            self.process([self.car], 0.5)["recognitionStatus"], "UNREADABLE"
        )

    def test_multiple_vehicles_or_multiple_plates_never_produce_read(self):
        second_car = Detection((11, 11, 89, 89), 0.95, "car")
        self.assertEqual(
            self.process([self.car, second_car], 0)["recognitionStatus"], "AMBIGUOUS"
        )
        self.pipeline.detector.detect.return_value = [self.region, self.region]
        self.assertEqual(
            self.process([self.car], 0.1)["recognitionStatus"], "AMBIGUOUS"
        )
        self.pipeline.read_region.assert_not_called()

    def test_vehicle_without_plate_region_is_unreadable(self):
        self.pipeline.detector.detect.return_value = []
        result = self.process([self.car], 0)
        self.assertEqual(result["recognitionStatus"], "UNREADABLE")
        self.assertEqual(result["vehicleConfidence"], 0.9)
        self.assertIsNone(result["ocrConfidence"])


@unittest.skipUnless(
    importlib.util.find_spec("cv2") and importlib.util.find_spec("numpy"),
    "OpenCV/NumPy not installed",
)
class PreprocessingTests(unittest.TestCase):
    def test_original_crop_blur_rejection_and_bounds(self):
        import numpy as np
        from vision.plate_preprocess import (
            PreprocessSettings,
            crop_original,
            preprocess,
        )

        frame = np.full((100, 200, 3), 255, dtype=np.uint8)
        crop = crop_original(frame, (-5, 10, 50, 40))
        self.assertEqual(crop.shape, (30, 50, 3))
        image, sharp = preprocess(crop, PreprocessSettings(scale=2))
        self.assertEqual(image.shape, (60, 100, 3))
        self.assertFalse(sharp)
        crop[:] = 0
        self.assertTrue(np.all(frame == 255))
        with self.assertRaises(ValueError):
            crop_original(frame, (500, 500, 600, 600))
