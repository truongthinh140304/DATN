from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PreprocessSettings:
    scale: float = 2.0
    grayscale: bool = True
    clahe: bool = True
    denoise: bool = False
    threshold: bool = False
    min_blur: float = 35.0


def crop_original(frame: Any, bbox: tuple[float, ...]) -> Any:
    import math

    height, width = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    left, top = max(0, math.floor(x1)), max(0, math.floor(y1))
    right, bottom = min(width, math.ceil(x2)), min(height, math.ceil(y2))
    if right <= left or bottom <= top:
        raise ValueError("Plate region is outside the original frame")
    return frame[top:bottom, left:right].copy()


def preprocess(crop: Any, settings: PreprocessSettings) -> tuple[Any, bool]:
    import cv2

    if not 0.25 <= settings.scale <= 8 or settings.min_blur < 0:
        raise ValueError("Invalid preprocessing scale or blur threshold")
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    # Measure on the original crop, before sharpening/upscaling can inflate it.
    sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var()) >= settings.min_blur
    image = gray if settings.grayscale or settings.clahe or settings.threshold else crop
    if settings.denoise:
        image = cv2.GaussianBlur(image, (3, 3), 0)
    if settings.clahe:
        image = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(image)
    image = cv2.resize(
        image, None, fx=settings.scale, fy=settings.scale, interpolation=cv2.INTER_CUBIC
    )
    if settings.threshold:
        _, image = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Paddle pipeline accepts three-channel BGR arrays.
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    return image, sharp
