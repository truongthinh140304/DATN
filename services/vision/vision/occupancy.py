from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone

from .domain import (
    Detection,
    DetectionAssignment,
    FrameOccupancy,
    OccupancyStatus,
    ParkingRoi,
)
from .geometry import assignment_evidence


@dataclass(frozen=True)
class OccupancyRules:
    vehicle_confidence: float = 0.35
    minimum_evidence: float = 0.28
    weak_evidence: float = 0.12
    ambiguity_margin: float = 0.08


def assign_detections(
    rois: list[ParkingRoi],
    detections: list[Detection],
    rules: OccupancyRules,
) -> tuple[list[DetectionAssignment], set[str]]:
    assignments: list[DetectionAssignment] = []
    uncertain_spots: set[str] = set()

    for detection in detections:
        ranked = sorted(
            (
                (assignment_evidence(detection.bbox, roi.polygon), roi)
                for roi in rois
            ),
            key=lambda item: item[0],
            reverse=True,
        )
        if not ranked or ranked[0][0] < rules.weak_evidence:
            continue

        best_evidence, best_roi = ranked[0]
        second_evidence = ranked[1][0] if len(ranked) > 1 else 0.0
        is_ambiguous = best_evidence - second_evidence < rules.ambiguity_margin
        is_confident = (
            detection.confidence >= rules.vehicle_confidence
            and best_evidence >= rules.minimum_evidence
            and not is_ambiguous
        )

        if is_confident:
            assignments.append(
                DetectionAssignment(
                    detection=detection,
                    roi=best_roi,
                    evidence=best_evidence,
                )
            )
        else:
            uncertain_spots.add(best_roi.spot_id)
            if is_ambiguous and len(ranked) > 1:
                uncertain_spots.add(ranked[1][1].spot_id)

    return assignments, uncertain_spots


def evaluate_frame(
    rois: list[ParkingRoi],
    detections: list[Detection],
    rules: OccupancyRules | None = None,
    observed_at: datetime | None = None,
) -> dict[str, FrameOccupancy]:
    rules = rules or OccupancyRules()
    observed_at = observed_at or datetime.now(timezone.utc)
    assignments, uncertain_spots = assign_detections(rois, detections, rules)
    by_spot: dict[str, list[DetectionAssignment]] = defaultdict(list)
    for assignment in assignments:
        by_spot[assignment.roi.spot_id].append(assignment)

    results: dict[str, FrameOccupancy] = {}
    for roi in rois:
        candidates = by_spot.get(roi.spot_id, [])
        if candidates:
            best = max(
                candidates,
                key=lambda item: item.detection.confidence * item.evidence,
            )
            confidence = min(1.0, best.detection.confidence * best.evidence)
            status = OccupancyStatus.OCCUPIED
            evidence = best.evidence
        elif roi.spot_id in uncertain_spots:
            confidence = 0.0
            status = OccupancyStatus.UNKNOWN
            evidence = 0.0
        else:
            confidence = 1.0
            status = OccupancyStatus.EMPTY
            evidence = 0.0
        results[roi.spot_id] = FrameOccupancy(
            spot_id=roi.spot_id,
            code=roi.code,
            status=status,
            confidence=confidence,
            evidence=evidence,
            observed_at=observed_at,
        )
    return results


class TemporalOccupancyFilter:
    def __init__(
        self,
        rois: list[ParkingRoi],
        window_size: int = 5,
        stable_frames: int = 3,
    ) -> None:
        if stable_frames > window_size:
            raise ValueError("stable_frames cannot exceed window_size")
        self.rois = {roi.spot_id: roi for roi in rois}
        self.stable_frames = stable_frames
        self.histories: dict[str, deque[FrameOccupancy]] = {
            roi.spot_id: deque(maxlen=window_size) for roi in rois
        }

    def camera_lost(
        self, observed_at: datetime | None = None
    ) -> dict[str, FrameOccupancy]:
        observed_at = observed_at or datetime.now(timezone.utc)
        for history in self.histories.values():
            history.clear()
        return {
            roi.spot_id: FrameOccupancy(
                spot_id=roi.spot_id,
                code=roi.code,
                status=OccupancyStatus.UNKNOWN,
                confidence=0.0,
                evidence=0.0,
                observed_at=observed_at,
            )
            for roi in self.rois.values()
        }

    def update(
        self, frame_results: dict[str, FrameOccupancy]
    ) -> dict[str, FrameOccupancy]:
        smoothed: dict[str, FrameOccupancy] = {}
        for spot_id, roi in self.rois.items():
            candidate = frame_results[spot_id]
            history = self.histories[spot_id]
            history.append(candidate)

            if candidate.status is OccupancyStatus.UNKNOWN:
                status = OccupancyStatus.UNKNOWN
                confidence = 0.0
            else:
                stable_candidates = [
                    item
                    for item in history
                    if item.status is not OccupancyStatus.UNKNOWN
                ]
                counts = Counter(item.status for item in stable_candidates)
                status, count = counts.most_common(1)[0]
                if count < self.stable_frames:
                    status = OccupancyStatus.UNKNOWN
                    confidence = 0.0
                else:
                    matching = [
                        item.confidence
                        for item in stable_candidates
                        if item.status is status
                    ]
                    confidence = sum(matching) / len(matching)

            smoothed[spot_id] = FrameOccupancy(
                spot_id=spot_id,
                code=roi.code,
                status=status,
                confidence=confidence,
                evidence=candidate.evidence,
                observed_at=candidate.observed_at,
            )
        return smoothed
