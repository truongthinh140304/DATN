"""Serial controller for Arduino Uno R3 barrier gate (SG90 on D4)."""

from __future__ import annotations

import contextlib
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SerialPortInfo:
    device: str
    description: str
    hwid: str


def list_serial_ports() -> list[SerialPortInfo]:
    try:
        from serial.tools import list_ports
    except ImportError:
        return []
    return [
        SerialPortInfo(
            device=port.device,
            description=port.description or "",
            hwid=port.hwid or "",
        )
        for port in list_ports.comports()
    ]


def select_arduino_port(
    preferred: str = "auto",
    ports: list[SerialPortInfo] | None = None,
) -> str | None:
    if preferred and preferred.lower() != "auto":
        return preferred
    available = ports if ports is not None else list_serial_ports()
    if not available:
        return None
    keywords = ("arduino", "ch340", "usb serial", "usb-serial", "ftdi", "uno")
    for port in available:
        text = f"{port.description} {port.hwid}".casefold()
        if any(token in text for token in keywords):
            return port.device
    return available[0].device


class ArduinoGateController:
    def __init__(
        self,
        *,
        enabled: bool = True,
        port: str = "auto",
        baudrate: int = 9600,
        default_open_ms: int = 5000,
        reset_delay_seconds: float = 2.0,
        serial_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.enabled = enabled
        self.configured_port = port
        self.baudrate = baudrate
        self.default_open_ms = default_open_ms
        self.reset_delay_seconds = reset_delay_seconds
        self._serial_factory = serial_factory
        self._lock = threading.Lock()
        self._conn: Any = None
        self.active_port: str | None = None
        self.last_error: str | None = None

    @property
    def is_connected(self) -> bool:
        return bool(self.enabled and self._conn is not None and getattr(self._conn, "is_open", True))

    def _open_serial(self, port_name: str) -> Any:
        if self._serial_factory is not None:
            return self._serial_factory(port_name, self.baudrate, timeout=1.5)
        try:
            import serial
        except ImportError as error:
            raise RuntimeError(
                "pyserial is not installed. Run: pip install -r requirements.txt"
            ) from error
        return serial.Serial(port_name, self.baudrate, timeout=1.5)

    def connect(self) -> bool:
        if not self.enabled:
            self.last_error = None
            return False
        with self._lock:
            if self._conn is not None and getattr(self._conn, "is_open", True):
                return True
            port_name = select_arduino_port(self.configured_port)
            if not port_name:
                self.last_error = "No serial COM port detected"
                return False
            try:
                conn = self._open_serial(port_name)
                if self.reset_delay_seconds > 0:
                    time.sleep(self.reset_delay_seconds)
                if hasattr(conn, "reset_input_buffer"):
                    conn.reset_input_buffer()
                conn.write(b"PING\n")
                conn.flush()
                reply = conn.readline().decode("utf-8", errors="ignore").strip()
                if reply not in {"PONG", "READY:GATE_CONTROLLER"}:
                    # Drain one more line in case READY arrived before PONG
                    second = conn.readline().decode("utf-8", errors="ignore").strip()
                    if second != "PONG" and reply != "PONG":
                        conn.close()
                        self.last_error = f"Unexpected handshake from {port_name}: {reply!r}"
                        return False
                self._conn = conn
                self.active_port = port_name
                self.last_error = None
                return True
            except (OSError, RuntimeError, ValueError, TypeError) as error:
                self._conn = None
                self.active_port = None
                self.last_error = str(error)
                return False

    def _send_command(self, command: str, expected_prefix: str) -> bool:
        if not self.enabled:
            return True
        if not self.is_connected and not self.connect():
            return False
        with self._lock:
            assert self._conn is not None
            try:
                if hasattr(self._conn, "reset_input_buffer"):
                    self._conn.reset_input_buffer()
                self._conn.write(f"{command}\n".encode("ascii"))
                self._conn.flush()
                for _ in range(3):
                    line = self._conn.readline().decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue
                    if line.startswith(expected_prefix):
                        return True
                return False
            except (OSError, RuntimeError, ValueError, TypeError) as error:
                self.last_error = str(error)
                with contextlib.suppress(OSError):
                    self._conn.close()
                self._conn = None
                self.active_port = None
                return False

    def open_gate(self, duration_ms: int | None = None) -> bool:
        ms = duration_ms if duration_ms is not None else self.default_open_ms
        return self._send_command(f"OPEN:{int(ms)}", "ACK:OPEN")

    def close_gate(self) -> bool:
        return self._send_command("CLOSE", "ACK:CLOSE")

    def ping(self) -> bool:
        if not self.enabled:
            return False
        return self._send_command("PING", "PONG")

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                with contextlib.suppress(OSError):
                    self._conn.close()
                self._conn = None
                self.active_port = None
