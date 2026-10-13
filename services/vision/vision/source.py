from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .config import parse_source


class SourceOpenError(RuntimeError):
    pass


def open_video_source(
    source: str | int,
    capture_factory: Callable[[str | int], Any] | None = None,
) -> Any:
    parsed_source = parse_source(source)
    if capture_factory is None:
        try:
            import cv2
        except ImportError as error:
            raise SourceOpenError(
                "OpenCV is not installed. Run: pip install -r requirements.txt"
            ) from error
        capture_factory = cv2.VideoCapture

    capture = capture_factory(parsed_source)
    if capture is None or not capture.isOpened():
        if capture is not None:
            capture.release()
        raise SourceOpenError(
            f"Cannot open video source {parsed_source!r}. Check webcam index, file path or RTSP URL."
        )
    return capture
