from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import TypeAlias

Point: TypeAlias = tuple[float, float]
BoundingBox: TypeAlias = tuple[float, float, float, float]


class OccupancyStatus(str, Enum):
    EMPTY = "EMPTY"
    OCCUPIED = "OCCUPIED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class ParkingRoi:
    spot_id: str
    code: str
    polygon: tuple[Point, ...]


@dataclass(frozen=True)
class Detection:
    bbox: BoundingBox
    confidence: float
    class_name: str


@dataclass(frozen=True)
class FrameOccupancy:
    spot_id: str
    code: str
    status: OccupancyStatus
    confidence: float
    evidence: float
    observed_at: datetime


@dataclass(frozen=True)
class DetectionAssignment:
    detection: Detection
    roi: ParkingRoi
    evidence: float
