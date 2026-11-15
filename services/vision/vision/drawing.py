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

    ui_scale = max(1.0, frame.shape[1] / 1000)
    overlay = frame.copy()
    for roi in rois:
        observation = observations[roi.spot_id]
        color = STATUS_COLORS[observation.status]
        points = np.array(roi.polygon, dtype=np.int32)
        cv2.fillPoly(overlay, [points], color)
        cv2.polylines(frame, [points], True, color, 2)
        label_x = int(min(point[0] for point in roi.polygon))
        label_y = int(min(point[1] for point in roi.polygon)) - 8
        label = f"{roi.code} {observation.status.value} {observation.confidence:.2f}"
        cv2.putText(
            frame,
            label,
            (label_x, max(22, label_y)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52 * ui_scale,
            color,
            max(2, round(2 * ui_scale)),
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
            0.5 * ui_scale,
            (230, 145, 45),
            max(2, round(2 * ui_scale)),
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
        "R select plate | SPACE pause/resume | Q quit",
        (18, 76),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        (205, 220, 218),
        1,
        cv2.LINE_AA,
    )
    return frame


def draw_recognition_panel(
    frame: Any,
    observations: dict[str, FrameOccupancy],
    recognitions: dict[str, dict],
) -> Any:
    """Readable OCR status on the preview, without modifying inference input."""
    import cv2

    scale = max(1.0, frame.shape[1] / 1000)
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.55 * scale
    thickness = max(2, round(scale))
    padding = round(12 * scale)
    row_height = round(24 * scale)
    lines = []
    for spot_id, item in recognitions.items():
        text = f"{observations[spot_id].code}: {item['recognitionStatus']}"
        if item.get("plateNormalized"):
            text += f"  {item['plateNormalized']}"
        if item.get("ocrConfidence") is not None:
            text += f"  OCR {item['ocrConfidence']:.0%}"
        color = (
            (100, 255, 130) if item["recognitionStatus"] == "READ" else (255, 230, 160)
        )
        lines.append((text, color))
    if not lines:
        return frame
    panel_width = (
        max(
            cv2.getTextSize(text, font, font_scale, thickness)[0][0]
            for text, _ in lines
        )
        + padding * 2
    )
    left = max(0, frame.shape[1] - panel_width - padding)
    top = padding
    cv2.rectangle(
        frame,
        (left, top),
        (frame.shape[1] - padding, top + padding * 2 + row_height * len(lines)),
        (24, 34, 42),
        -1,
    )
    for index, (text, color) in enumerate(lines):
        cv2.putText(
            frame,
            text,
            (
                left + padding,
                top + padding + (index + 1) * row_height - round(6 * scale),
            ),
            font,
            font_scale,
            color,
            thickness,
            cv2.LINE_AA,
        )
    return frame
