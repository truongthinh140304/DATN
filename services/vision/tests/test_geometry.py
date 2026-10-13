import unittest

from vision.geometry import (
    assignment_evidence,
    clip_polygon_to_box,
    overlap_metrics,
    point_in_polygon,
    polygon_area,
)


class GeometryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.square = ((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0))

    def test_polygon_area_and_point_membership(self) -> None:
        self.assertAlmostEqual(polygon_area(self.square), 100.0)
        self.assertTrue(point_in_polygon((5.0, 5.0), self.square))
        self.assertTrue(point_in_polygon((0.0, 5.0), self.square))
        self.assertFalse(point_in_polygon((11.0, 5.0), self.square))

    def test_polygon_box_intersection(self) -> None:
        clipped = clip_polygon_to_box(self.square, (5.0, 5.0, 15.0, 15.0))
        self.assertAlmostEqual(polygon_area(clipped), 25.0)
        box_overlap, roi_overlap, anchor_ratio = overlap_metrics(
            (5.0, 5.0, 15.0, 15.0), self.square
        )
        self.assertAlmostEqual(box_overlap, 0.25)
        self.assertAlmostEqual(roi_overlap, 0.25)
        self.assertGreaterEqual(anchor_ratio, 0.0)

    def test_evidence_uses_overlap_and_lower_vehicle_points(self) -> None:
        strong = assignment_evidence((1.0, 1.0, 9.0, 9.0), self.square)
        weak = assignment_evidence((8.0, 8.0, 18.0, 18.0), self.square)
        self.assertGreater(strong, weak)
        self.assertGreater(strong, 0.7)


if __name__ == "__main__":
    unittest.main()
