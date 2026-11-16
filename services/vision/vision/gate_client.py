"""HTTP client communicating with the Express Smart Parking Gate API."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


class GateApiClient:
    def __init__(
        self, api_url: str, api_key: str, timeout_seconds: float = 5.0
    ) -> None:
        self.base_url = api_url.rstrip("/")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    def _headers(self) -> dict[str, str]:
        return {"x-vision-api-key": self.api_key}

    def get_lots(self) -> list[dict[str, Any]]:
        import requests

        response = requests.get(
            f"{self.base_url}/api/gate/lots",
            headers=self._headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return list(response.json().get("items", []))

    def scan(
        self,
        *,
        gate_id: str,
        plate_raw: str,
        ocr_confidence: float,
        plate_samples: int,
        lot_id: str | None = None,
        vehicle_confidence: float | None = None,
        timestamp: datetime | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        import requests

        payload: dict[str, Any] = {
            "gateId": gate_id,
            "plateRaw": plate_raw,
            "ocrConfidence": round(float(ocr_confidence), 4),
            "plateSamples": int(plate_samples),
            "timestamp": (timestamp or datetime.now(UTC)).isoformat(),
        }
        if lot_id:
            payload["lotId"] = lot_id
        if vehicle_confidence is not None:
            payload["vehicleConfidence"] = round(float(vehicle_confidence), 4)
        if metadata:
            payload["metadata"] = metadata

        response = requests.post(
            f"{self.base_url}/api/gate/scan",
            json=payload,
            headers=self._headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return dict(response.json())

    def heartbeat(
        self,
        *,
        gate_id: str,
        lot_id: str | None,
        camera_connected: bool,
        arduino_connected: bool,
        arduino_port: str | None,
    ) -> None:
        import requests

        response = requests.post(
            f"{self.base_url}/api/gate/heartbeat",
            json={
                "gateId": gate_id,
                "lotId": lot_id,
                "cameraConnected": camera_connected,
                "arduinoConnected": arduino_connected,
                "arduinoPort": arduino_port,
            },
            headers=self._headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()

    def claim_command(self, gate_id: str) -> dict[str, Any] | None:
        import requests

        response = requests.post(
            f"{self.base_url}/api/gate/commands/claim",
            json={"gateId": gate_id},
            headers=self._headers(),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return response.json().get("command")
