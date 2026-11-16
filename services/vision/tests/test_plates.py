import unittest

from vision.plate_ocr import PlateReading, parse_prediction
from vision.plate_temporal import PlateConsensus
from vision.plate_text import normalize_plate, plausible_plate


class PlateTests(unittest.TestCase):
    def test_normalization_preserves_ambiguous_characters(self):
        self.assertEqual(normalize_plate(" 30a–123.45\n"), "30A12345")
        self.assertEqual(normalize_plate("30A-OI123"), "30AOI123")
        self.assertFalse(plausible_plate("30AOI123"))
        self.assertFalse(plausible_plate(normalize_plate("30A@12345")))
        self.assertTrue(plausible_plate("51F12345"))

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
        votes = PlateConsensus(samples=3, window=5, ttl=4.0, confidence=0.65)
        good = PlateReading("30A-12345", "30A12345", 0.95)
        self.assertIsNone(votes.update("gate", good, 0)[0])
        self.assertIsNone(votes.update("gate", good, 0.1)[0])
        self.assertIsNotNone(votes.update("gate", good, 0.2)[0])
        self.assertIsNone(votes.update("gate", PlateReading(), 0.3)[0])
        self.assertIsNone(votes.update("gate", good, 5)[0])
        votes.reset()
        self.assertIsNone(votes.update("gate", good, 5.1)[0])

    def test_gate_default_two_sample_consensus(self):
        votes = PlateConsensus()
        good = PlateReading("30A-12345", "30A12345", 0.91)
        stable, count = votes.update("main-gate-01", good, 1.0)
        self.assertIsNone(stable)
        self.assertEqual(count, 1)
        stable, count = votes.update("main-gate-01", good, 1.3)
        self.assertIsNotNone(stable)
        self.assertEqual(count, 2)


if __name__ == "__main__":
    unittest.main()
