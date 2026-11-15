from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .config import parse_source


class SourceOpenError(RuntimeError):
    pass


def open_video_source(
    source: str | int,
    capture_factory: Callable[[str | int], Any] | None = None,
    *,
    backend: str = "auto",
    camera_name: str | None = None,
) -> Any:
    if backend not in {"auto", "dshow", "msmf"}:
        raise SourceOpenError("Video backend must be auto, dshow or msmf")
    parsed_source = parse_source(source)
    if capture_factory is None:
        try:
            import cv2
        except ImportError as error:
            raise SourceOpenError(
                "OpenCV is not installed. Run: pip install -r requirements.txt"
            ) from error
        backend_id = {
            "auto": cv2.CAP_ANY,
            "dshow": cv2.CAP_DSHOW,
            "msmf": cv2.CAP_MSMF,
        }[backend]
        if camera_name:
            if not isinstance(parsed_source, int):
                raise SourceOpenError("cameraName is only supported for webcam sources")
            try:
                from cv2_enumerate_cameras import enumerate_cameras
            except ImportError as error:
                raise SourceOpenError(
                    "Install requirements.txt to select a camera by name"
                ) from error
            cameras = [
                item
                for item in enumerate_cameras(backend_id)
                if item.name.casefold() == camera_name.casefold()
            ]
            if len(cameras) != 1:
                raise SourceOpenError(
                    f"Expected one camera named {camera_name!r}, found {len(cameras)}. Check the USB connection and backend."
                )
            parsed_source, backend_id = cameras[0].index, cameras[0].backend
        capture_factory = lambda value: cv2.VideoCapture(value, backend_id)

    capture = capture_factory(parsed_source)
    if capture is None or not capture.isOpened():
        if capture is not None:
            capture.release()
        raise SourceOpenError(
            f"Cannot open video source {parsed_source!r}. Check webcam index, file path or RTSP URL."
        )
    return capture
