"""Bounded, expiring votes; never reuse an old plate when a current frame fails."""

from collections import Counter, deque

from .plate_ocr import PlateReading
from .plate_text import plausible_plate


class PlateConsensus:
    def __init__(
        self,
        samples: int = 2,
        window: int = 5,
        ttl: float = 4.0,
        confidence: float = 0.65,
    ):
        if not 1 <= samples <= window or ttl <= 0 or not 0 <= confidence <= 1:
            raise ValueError("Invalid consensus settings")
        self.samples, self.window, self.ttl, self.confidence = (
            samples,
            window,
            ttl,
            confidence,
        )
        self.histories: dict[str, deque] = {}

    def reset(self, key: str | None = None) -> None:
        if key is None:
            self.histories.clear()
        else:
            self.histories.pop(key, None)

    def update(
        self, key: str, reading: PlateReading, now: float
    ) -> tuple[PlateReading | None, int]:
        history = self.histories.setdefault(key, deque(maxlen=self.window))
        while history and now - history[0][0] > self.ttl:
            history.popleft()
        valid = reading.confidence >= self.confidence and plausible_plate(
            reading.normalized
        )
        history.append((now, reading if valid else PlateReading()))
        if not valid:
            return None, 0
        counts = Counter(item.normalized for _, item in history if item.normalized)
        winners = counts.most_common()
        best, count = winners[0]
        if (
            count < self.samples
            or best != reading.normalized
            or (len(winners) > 1 and winners[1][1] == count)
        ):
            return None, count
        matching = [item for _, item in history if item.normalized == best]
        return PlateReading(
            reading.raw, best, min(item.confidence for item in matching)
        ), count
