import unittest

from vision.arduino_gate import (
    ArduinoGateController,
    SerialPortInfo,
    select_arduino_port,
)


class FakeSerialConn:
    def __init__(self, responses: list[bytes]) -> None:
        self.responses = list(responses)
        self.written: list[bytes] = []
        self.is_open = True

    def reset_input_buffer(self) -> None:
        pass

    def write(self, data: bytes) -> None:
        self.written.append(data)

    def flush(self) -> None:
        pass

    def readline(self) -> bytes:
        if self.responses:
            return self.responses.pop(0)
        return b""

    def close(self) -> None:
        self.is_open = False


class ArduinoGateTests(unittest.TestCase):
    def test_select_arduino_port_prefers_uno_or_ch340(self) -> None:
        ports = [
            SerialPortInfo("COM1", "Standard Communications Port", "PNP0501"),
            SerialPortInfo("COM5", "USB-SERIAL CH340 (COM5)", "USB\\VID_1A86"),
        ]
        self.assertEqual(select_arduino_port("auto", ports), "COM5")
        self.assertEqual(select_arduino_port("COM7", ports), "COM7")
        self.assertIsNone(select_arduino_port("auto", []))

    def test_handshake_open_and_close_commands(self) -> None:
        fake = FakeSerialConn(
            [
                b"READY:GATE_CONTROLLER\n",
                b"PONG\n",
                b"ACK:OPEN:5000\n",
                b"ACK:CLOSE\n",
            ]
        )
        gate = ArduinoGateController(
            enabled=True,
            port="COM5",
            default_open_ms=5000,
            reset_delay_seconds=0.0,
            serial_factory=lambda port, baud, timeout=1.5: fake,
        )
        self.assertTrue(gate.connect())
        self.assertTrue(gate.is_connected)
        self.assertTrue(gate.open_gate())
        self.assertTrue(gate.close_gate())
        self.assertEqual(fake.written, [b"PING\n", b"OPEN:5000\n", b"CLOSE\n"])
        gate.close()
        self.assertFalse(gate.is_connected)

    def test_disabled_controller_simulates_success_without_serial(self) -> None:
        gate = ArduinoGateController(enabled=False)
        self.assertFalse(gate.connect())
        self.assertTrue(gate.open_gate(3000))
        self.assertTrue(gate.close_gate())


if __name__ == "__main__":
    unittest.main()
