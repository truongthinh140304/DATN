import json
import tempfile
import unittest
from pathlib import Path

from vision.config import load_gate_settings, parse_source, save_scan_region
from vision.source import SourceOpenError, open_video_source


class FakeCapture:
    def __init__(self, opened: bool) -> None:
        self.opened = opened
        self.released = False

    def isOpened(self) -> bool:
        return self.opened

    def release(self) -> None:
        self.released = True


class ConfigAndSourceTests(unittest.TestCase):
    def test_source_parser_supports_webcam_file_and_rtsp(self) -> None:
        self.assertEqual(parse_source("0"), 0)
        self.assertEqual(parse_source("sample.mp4"), "sample.mp4")
        self.assertEqual(parse_source("rtsp://camera/live"), "rtsp://camera/live")

    def test_invalid_source_raises_clear_error(self) -> None:
        fake = FakeCapture(False)
        with self.assertRaises(SourceOpenError):
            open_video_source("missing.mp4", lambda _source: fake)
        self.assertTrue(fake.released)

    def test_gate_config_load_and_scan_region_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "gate.json"
            config_path.write_text(
                json.dumps(
                    {
                        "gateId": "main-gate-01",
                        "source": "0",
                        "videoBackend": "dshow",
                        "plateMode": "scan_zone",
                        "scanRegion": [0.1, 0.2, 0.9, 0.85],
                        "arduino": {"enabled": True, "port": "COM4", "openMs": 5000},
                    }
                ),
                encoding="utf-8",
            )
            settings = load_gate_settings(config_path)
            self.assertEqual(settings.gate_id, "main-gate-01")
            self.assertEqual(settings.source, 0)
            self.assertEqual(settings.scan_region, (0.1, 0.2, 0.9, 0.85))
            self.assertEqual(settings.arduino.port, "COM4")

            save_scan_region(config_path, (0.2, 0.3, 0.8, 0.75))
            updated = load_gate_settings(config_path)
            self.assertEqual(updated.scan_region, (0.2, 0.3, 0.8, 0.75))

    def test_invalid_scan_region_or_mode_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "gate.json"
            config_path.write_text(
                json.dumps({"scanRegion": [0.8, 0.2, 0.2, 0.9]}), encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                load_gate_settings(config_path)

            config_path.write_text(
                json.dumps({"plateMode": "invalid_mode"}), encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                load_gate_settings(config_path)


if __name__ == "__main__":
    unittest.main()
