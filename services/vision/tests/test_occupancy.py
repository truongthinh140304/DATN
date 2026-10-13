import unittest
from datetime import datetime, timezone

from vision.domain import Detection, OccupancyStatus, ParkingRoi
from vision.occupancy import (
    OccupancyRules,
    TemporalOccupancyFilter,
    assign_detections,
    evaluate_frame,
)


class OccupancyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime.now(timezone.utc)
        self.rois = [
            ParkingRoi("spot-a01", "A01", ((0, 0), (100, 0), (100, 100), (0, 100))),
            ParkingRoi(
                "spot-a02", "A02", ((110, 0), (210, 0), (210, 100), (110, 100))
            ),
        ]

    def test_no_vehicle_is_empty(self) -> None:
        results = evaluate_frame(self.rois, [], observed_at=self.now)
        self.assertEqual(results["spot-a01"].status, OccupancyStatus.EMPTY)
        self.assertEqual(results["spot-a01"].confidence, 1.0)

    def test_confident_vehicle_is_assigned_to_one_spot(self) -> None:
        detection = Detection((10, 10, 90, 95), 0.92, "car")
        assignments, uncertain = assign_detections(
            self.rois, [detection], OccupancyRules()
        )
        self.assertEqual(len(assignments), 1)
        self.assertEqual(assignments[0].roi.spot_id, "spot-a01")
        self.assertEqual(uncertain, set())
        results = evaluate_frame(self.rois, [detection], observed_at=self.now)
        self.assertEqual(results["spot-a01"].status, OccupancyStatus.OCCUPIED)
        self.assertEqual(results["spot-a02"].status, OccupancyStatus.EMPTY)

    def test_uncertain_detection_returns_unknown(self) -> None:
        low_confidence = Detection((10, 10, 90, 95), 0.2, "car")
        results = evaluate_frame(self.rois, [low_confidence], observed_at=self.now)
        self.assertEqual(results["spot-a01"].status, OccupancyStatus.UNKNOWN)

    def test_ambiguous_vehicle_is_not_assigned_to_two_spots(self) -> None:
        adjacent_rois = [
            ParkingRoi("left", "A01", ((0, 0), (100, 0), (100, 100), (0, 100))),
            ParkingRoi(
                "right", "A02", ((100, 0), (200, 0), (200, 100), (100, 100))
            ),
        ]
        centered_between_spots = Detection((50, 10, 150, 95), 0.95, "car")

        assignments, uncertain = assign_detections(
            adjacent_rois, [centered_between_spots], OccupancyRules()
        )

        self.assertEqual(assignments, [])
        self.assertEqual(uncertain, {"left", "right"})

    def test_temporal_filter_reduces_flicker_and_camera_loss_is_unknown(self) -> None:
        temporal = TemporalOccupancyFilter(self.rois, window_size=5, stable_frames=3)
        occupied = evaluate_frame(
            self.rois,
            [Detection((10, 10, 90, 95), 0.95, "car")],
            observed_at=self.now,
        )
        first = temporal.update(occupied)
        second = temporal.update(occupied)
        third = temporal.update(occupied)
        self.assertEqual(first["spot-a01"].status, OccupancyStatus.UNKNOWN)
        self.assertEqual(second["spot-a01"].status, OccupancyStatus.UNKNOWN)
        self.assertEqual(third["spot-a01"].status, OccupancyStatus.OCCUPIED)

        lost = temporal.camera_lost(self.now)
        self.assertTrue(
            all(item.status is OccupancyStatus.UNKNOWN for item in lost.values())
        )


if __name__ == "__main__":
    unittest.main()
