from __future__ import annotations

from typing import Any

from .domain import FrameOccupancy


class VisionApiReporter:
    def __init__(self, api_url: str, api_key: str, timeout_seconds: float = 5.0):
        self.endpoint = f"{api_url.rstrip('/')}/api/vision/observations"
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    def send(
        self,
        camera_id: str,
        observations: dict[str, FrameOccupancy],
        metadata: dict[str, Any] | None = None,
        recognitions: dict[str, dict] | None = None,
    ) -> int:
        try:
            import requests
        except ImportError as error:
            raise RuntimeError(
                "Requests is not installed. Run: pip install -r requirements.txt"
            ) from error

        payload = {
            "observations": [
                {
                    "cameraId": camera_id,
                    "spotId": item.spot_id,
                    "occupancyStatus": item.status.value,
                    "confidence": round(item.confidence, 4),
                    "timestamp": item.observed_at.isoformat(),
                    **((recognitions or {}).get(item.spot_id, {})),
                    "metadata": {
                        "spotCode": item.code,
                        "evidence": round(item.evidence, 4),
                        **(metadata or {}),
                    },
                }
                for item in observations.values()
            ]
        }
        accepted = 0
        for offset in range(0, len(payload["observations"]), 50):
            response = requests.post(
                self.endpoint,
                json={"observations": payload["observations"][offset : offset + 50]},
                headers={"x-vision-api-key": self.api_key},
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            accepted += int(response.json()["accepted"])
        return accepted
