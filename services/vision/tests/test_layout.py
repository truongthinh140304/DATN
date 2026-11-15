import unittest

from vision.geometry import is_simple_polygon
from vision.layout import grid_rois


class LayoutTests(unittest.TestCase):
    def test_guides_follow_selected_database_ids_without_overlapping(self):
        for count in (1, 3, 4):
            spots = [{"id": f"spot-{i}", "code": f"A0{i + 1}"} for i in range(count)]
            rois = grid_rois(spots, count)
            self.assertEqual(
                [roi.spot_id for roi in rois], [spot["id"] for spot in spots]
            )
            for index, roi in enumerate(rois):
                self.assertTrue(is_simple_polygon(roi.polygon))
                self.assertTrue(
                    all(0 <= x <= 1 and 0 <= y <= 1 for x, y in roi.polygon)
                )
                if index:
                    self.assertGreater(roi.polygon[0][0], rois[index - 1].polygon[1][0])
            self.assertEqual(len(rois), count)

    def test_multiple_rows_and_invalid_column_counts(self):
        spots = [{"id": str(i), "code": str(i)} for i in range(4)]
        rois = grid_rois(spots, 2)
        self.assertGreater(rois[2].polygon[0][1], rois[0].polygon[2][1])
        for columns in (0, 5):
            with self.assertRaises(ValueError):
                grid_rois(spots, columns)
