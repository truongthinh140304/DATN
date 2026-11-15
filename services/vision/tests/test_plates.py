import json
import tempfile
import unittest
from pathlib import Path

from vision.domain import Detection, ParkingRoi
from vision.plate_detector import PlateDetector, PlateRegion
from vision.plate_ocr import PlateReading, parse_prediction
from vision.plate_pipeline import associate_regions
from vision.plate_temporal import PlateConsensus
from vision.plate_text import normalize_plate, plausible_plate
from vision.roi_tool import load_spot_mapping


class PlateTests(unittest.TestCase):
    def test_normalization_preserves_ambiguous_characters(self):
        self.assertEqual(normalize_plate(" 30a–123.45\n"), "30A12345")
        self.assertEqual(normalize_plate("30A-OI123"), "30AOI123")
        self.assertFalse(plausible_plate("30AOI123"))
        self.assertFalse(plausible_plate(normalize_plate("30A@12345")))

    def test_empty_and_two_line_paddle_predictions(self):
        self.assertEqual(parse_prediction([]), PlateReading())
        reading = parse_prediction(
            [
                {
                    "rec_texts": ["123.45", "30A"],
                    "rec_scores": [0.9, 0.85],
                    "rec_boxes": [[0, 30, 50, 45], [0, 0, 50, 20]],
                }
            ]
        )
        self.assertEqual(reading.raw, "30A\n123.45")
        self.assertEqual(reading.normalized, "30A12345")
        self.assertEqual(reading.confidence, 0.85)

    def test_votes_require_current_valid_frame_and_expire(self):
        votes = PlateConsensus()
        good = PlateReading("30A-12345", "30A12345", 0.95)
        self.assertIsNone(votes.update("a", good, 0)[0])
        self.assertIsNone(votes.update("a", good, 0.1)[0])
        self.assertIsNotNone(votes.update("a", good, 0.2)[0])
        self.assertIsNone(votes.update("a", PlateReading(), 0.3)[0])
        self.assertIsNone(votes.update("a", good, 5)[0])
        votes.reset()
        self.assertIsNone(votes.update("a", good, 5.1)[0])

    def test_plate_needs_one_vehicle_and_one_unambiguous_spot(self):
        a = ParkingRoi("a", "A01", ((0, 0), (100, 0), (100, 100), (0, 100)))
        b = ParkingRoi("b", "A02", ((100, 0), (200, 0), (200, 100), (100, 100)))
        car = Detection((10, 10, 90, 90), 0.9, "car")
        plate = PlateRegion((30, 40, 60, 60), None, "MANUAL_EXPERIMENT")
        linked, uncertain, _ = associate_regions([a, b], [car], [plate])
        self.assertEqual(list(linked), ["a"])
        self.assertFalse(uncertain)
        linked, _, _ = associate_regions([a, b], [], [plate])
        self.assertFalse(linked)  # OCR alone never proves toy-car occupancy.
        linked, uncertain, _ = associate_regions(
            [a, a.__class__("b", "B", a.polygon)], [car], [plate]
        )
        self.assertFalse(linked)
        self.assertEqual(uncertain, {"a", "b"})
        other = Detection((12, 12, 88, 88), 0.95, "car")
        linked, uncertain, _ = associate_regions([a], [car, other], [plate])
        self.assertFalse(linked)
        self.assertIn("a", uncertain)

    def test_spot_count_is_configured_and_duplicates_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spots.json"
            for count in (3, 4, 5):
                path.write_text(
                    json.dumps(
                        {
                            "cameraId": "c",
                            "spots": [
                                {"spotId": str(i), "code": f"A{i}"}
                                for i in range(count)
                            ],
                        }
                    )
                )
                self.assertEqual(len(load_spot_mapping(path)[1]), count)
            path.write_text(json.dumps({"cameraId": "c", "spots": []}))
            with self.assertRaises(ValueError):
                load_spot_mapping(path)

    def test_missing_plate_model_fails_instead_of_downloading_vehicle_weights(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                PlateDetector(
                    {"mode": "model", "modelPath": "absent.pt"}, Path(directory)
                )


if __name__ == "__main__":
    unittest.main()
