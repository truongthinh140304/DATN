"""Operator-confirmed image guides, not automatic physical parking calibration."""

import math

from .domain import ParkingRoi


def grid_rois(spots: list[dict], columns: int) -> list[ParkingRoi]:
    if not spots or columns < 1 or columns > len(spots):
        raise ValueError("Grid columns must be between 1 and the selected spot count")
    rows = math.ceil(len(spots) / columns)
    left, top, right, bottom = 0.04, 0.27, 0.96, 0.94
    width, height = (right - left) / columns, (bottom - top) / rows
    gap = min(width, height) * 0.04
    result = []
    for index, spot in enumerate(spots):
        row, column = divmod(index, columns)
        x1, y1 = left + column * width + gap, top + row * height + gap
        x2, y2 = left + (column + 1) * width - gap, top + (row + 1) * height - gap
        result.append(
            ParkingRoi(
                spot["id"], spot["code"], ((x1, y1), (x2, y1), (x2, y2), (x1, y2))
            )
        )
    return result


def draw_layout_guides(frame, rois: list[ParkingRoi]):
    import cv2
    import numpy as np

    height, width = frame.shape[:2]
    for roi in rois:
        points = np.array(
            [(round(x * width), round(y * height)) for x, y in roi.polygon],
            dtype=np.int32,
        )
        cv2.polylines(frame, [points], True, (0, 240, 255), 3)
        x, y = points[0]
        cv2.putText(
            frame,
            f"{roi.code} - GUIDE",
            (int(x) + 8, int(y) + 35),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.85,
            (0, 0, 0),
            5,
        )
        cv2.putText(
            frame,
            f"{roi.code} - GUIDE",
            (int(x) + 8, int(y) + 35),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.85,
            (0, 240, 255),
            2,
        )
    return frame
