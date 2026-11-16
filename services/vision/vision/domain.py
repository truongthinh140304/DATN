from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias

BoundingBox: TypeAlias = tuple[float, float, float, float]


@dataclass(frozen=True)
class Detection:
    bbox: BoundingBox
    confidence: float
    class_name: str
