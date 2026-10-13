from __future__ import annotations

from typing import Any

from .domain import Detection, FrameOccupancy, OccupancyStatus, ParkingRoi

STATUS_COLORS = {
    OccupancyStatus.EMPTY: (70, 180, 90),
    OccupancyStatus.OCCUPIED: (65, 65, 220),
    OccupancyStatus.UNKNOWN: (70, 190, 230),
}


def draw_overlay(
    frame: Any,
    rois: list[ParkingRoi],
    detections: list[Detection],
    observations: dict[str, FrameOccupancy],
    fps: float,
) -> Any:
    import cv2
    import numpy as np

    overlay = frame.copy()
    for roi in rois:
        observation = observations[roi.spot_id]
        color = STATUS_COLORS[observation.status]
        points = np.array(roi.polygon, dtype=np.int32)
        cv2.fillPoly(overlay, [points], color)
        cv2.polylines(frame, [points], True, color, 2)
        label_x = int(min(point[0] for point in roi.polygon))
        label_y = int(min(point[1] for point in roi.polygon)) - 8
        label = (
            f"{roi.code} {observation.status.value} "
            f"{observation.confidence:.2f}"
        )
        cv2.putText(
            frame,
            label,
            (label_x, max(22, label_y)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            color,
            2,
            cv2.LINE_AA,
        )
    cv2.addWeighted(overlay, 0.16, frame, 0.84, 0, frame)

    for detection in detections:
        x1, y1, x2, y2 = (int(value) for value in detection.bbox)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (230, 145, 45), 2)
        cv2.putText(
            frame,
            f"{detection.class_name} {detection.confidence:.2f}",
            (x1, max(20, y1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (230, 145, 45),
            2,
            cv2.LINE_AA,
        )

    occupied = sum(
        item.status is OccupancyStatus.OCCUPIED for item in observations.values()
    )
    cv2.rectangle(frame, (8, 8), (360, 88), (24, 34, 42), -1)
    cv2.putText(
        frame,
        f"FPS: {fps:.1f} | Occupied: {occupied}/{len(rois)}",
        (18, 34),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (245, 245, 245),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        f"Observed: {next(iter(observations.values())).observed_at:%H:%M:%S} UTC",
        (18, 56),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        (205, 220, 218),
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        "SPACE pause/resume | Q or ESC quit",
        (18, 76),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        (205, 220, 218),
        1,
        cv2.LINE_AA,
    )
    return frame
